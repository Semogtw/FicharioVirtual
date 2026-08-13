import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const required = [
	'TARGET_URL',
	'STAGING_SUPABASE_URL',
	'STAGING_SUPABASE_PUBLISHABLE_KEY',
	'STAGING_AUTHORIZED_EMAIL',
	'STAGING_AUTHORIZED_PASSWORD'
];
for (const name of required) {
	if (!process.env[name]) throw new Error(`Missing required special-route setting: ${name}`);
}

const target = new URL(process.env.TARGET_URL);
if (target.protocol !== 'https:' || target.pathname !== '/' || target.search || target.hash) {
	throw new Error('TARGET_URL must be a clean HTTPS origin');
}

const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.STAGING_AUTHORIZED_EMAIL;
const password = process.env.STAGING_AUTHORIZED_PASSWORD;
const reportPath = process.env.REAL_APP_SPECIAL_REPORT_PATH ?? '/tmp/real-app-special-report.json';
const evidenceDir = process.env.REAL_APP_SPECIAL_EVIDENCE_DIR ?? '/tmp/real-app-special-evidence';

const report = {
	target: target.origin,
	targetSha: process.env.TARGET_SHA ?? null,
	startedAt: new Date().toISOString(),
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], serverErrors: [] },
	blocked: [
		{
			feature: 'Seleção humana dentro do Google Picker',
			reason:
				'O runner valida a página, a configuração e a disponibilidade do seletor, mas não possui uma sessão Google humana para escolher e consentir um arquivo externo.'
		},
		{
			feature: 'Captura física da câmera Android',
			reason:
				'O runner valida o input capture=environment e o restante do pipeline de imagens é exercitado pelos fluxos reais principais, mas não consegue acionar a câmera física do tablet.'
		}
	]
};

function safeError(error) {
	return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function stage(name, status, detail = null) {
	report.stages.push({
		name,
		status,
		at: new Date().toISOString(),
		...(detail ? { detail } : {})
	});
}

async function persistReport() {
	await mkdir(path.dirname(reportPath), { recursive: true });
	await mkdir(evidenceDir, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function login(page) {
	await page.goto(new URL('/login/', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(password);
	await page.getByRole('button', { name: 'Entrar', exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function openRoute(page, route, heading) {
	await page.goto(new URL(route, target).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	await page
		.getByRole('heading', { name: heading, exact: true })
		.waitFor({ state: 'visible', timeout: 25_000 });
	const alert = page.locator('[role="alert"]:visible').first();
	if (await alert.count()) {
		const text = (await alert.innerText()).trim();
		if (text) throw new Error(`${route} exposed an alert: ${text.slice(0, 300)}`);
	}
}

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
let browser;
let page;

try {
	stage('backend-auth', 'running');
	const { error: authError } = await client.auth.signInWithPassword({ email, password });
	if (authError) throw authError;
	const { data: driveConnection, error: driveError } = await client
		.from('drive_connections')
		.select('status,root_folder_id')
		.maybeSingle();
	if (driveError || driveConnection?.status !== 'connected' || !driveConnection.root_folder_id) {
		throw new Error('The protected staging account does not have a usable Google Drive connection');
	}
	stage('backend-auth', 'pass');

	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		locale: 'pt-BR'
	});
	page = await context.newPage();
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('response', (response) => {
		if (response.status() < 500) return;
		const url = new URL(response.url());
		if (url.origin === target.origin || url.origin === new URL(supabaseUrl).origin) {
			report.browser.serverErrors.push(`${response.status()} ${url.origin}${url.pathname}`);
		}
	});

	stage('real-login', 'running');
	await login(page);
	stage('real-login', 'pass');

	stage('pdf-import-alias-ui', 'running');
	await openRoute(page, '/import/pdf/', 'Adicionar ao fichário');
	const pdfInput = page.locator('input[type="file"][accept*="application/pdf"]').first();
	await pdfInput.waitFor({ state: 'attached', timeout: 20_000 });
	const cameraInput = page.locator('input[type="file"][capture="environment"]').first();
	await cameraInput.waitFor({ state: 'attached', timeout: 20_000 });
	const cameraAccept = await cameraInput.getAttribute('accept');
	if (cameraAccept !== 'image/*') throw new Error('Camera input no longer accepts captured images');
	const originalMode = page.locator('input[name="image-mode"][value="original"]');
	const standardMode = page.locator('input[name="image-mode"][value="standard"]');
	await originalMode.check();
	if (!(await originalMode.isChecked()))
		throw new Error('Original image mode could not be selected');
	await standardMode.check();
	if (!(await standardMode.isChecked()))
		throw new Error('Standard image mode could not be restored');
	stage('pdf-import-alias-ui', 'pass');

	stage('drive-picker-entry-ui', 'running');
	await openRoute(page, '/import/drive/', 'Importar do Google Drive');
	if (await page.getByText('Google Picker ainda não configurado', { exact: true }).count()) {
		throw new Error('Google Picker is not configured in the deployed app');
	}
	const pickerButton = page.getByRole('button', {
		name: 'Escolher no Google Drive',
		exact: true
	});
	await pickerButton.waitFor({ state: 'visible', timeout: 30_000 });
	const pickerReadyDeadline = Date.now() + 30_000;
	while ((await pickerButton.isDisabled()) && Date.now() < pickerReadyDeadline) {
		const alert = page.locator('[role="alert"]:visible').first();
		if (await alert.count()) {
			const text = (await alert.innerText()).trim();
			if (text) throw new Error(`/import/drive/ exposed an alert: ${text.slice(0, 300)}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	if (await pickerButton.isDisabled()) {
		throw new Error('Google Picker entry button remained disabled after asynchronous page data loaded');
	}
	await page.locator('section.options select').waitFor({ state: 'visible', timeout: 20_000 });
	stage(
		'drive-picker-entry-ui',
		'pass',
		'Picker configurado e entrada habilitada; a escolha humana externa permanece explicitamente bloqueada no CI.'
	);

	if (report.browser.pageErrors.length > 0) {
		throw new Error(`Browser page errors observed: ${report.browser.pageErrors.join(' | ')}`);
	}
	if (report.browser.serverErrors.length > 0) {
		throw new Error(`Server 5xx responses observed: ${report.browser.serverErrors.join(' | ')}`);
	}

	report.status = 'pass';
	await page.screenshot({ path: path.join(evidenceDir, 'final.png'), fullPage: true });
} catch (error) {
	report.status = 'fail';
	report.error = safeError(error);
	if (page) {
		await mkdir(evidenceDir, { recursive: true });
		await page
			.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: true })
			.catch(() => undefined);
	}
	throw error;
} finally {
	report.finishedAt = new Date().toISOString();
	await persistReport();
	await browser?.close().catch(() => undefined);
	await client.auth.signOut().catch(() => undefined);
}
