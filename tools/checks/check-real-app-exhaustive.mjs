import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const required = [
	'TARGET_URL',
	'STAGING_SUPABASE_URL',
	'STAGING_SUPABASE_PUBLISHABLE_KEY',
	'STAGING_AUTHORIZED_EMAIL',
	'STAGING_AUTHORIZED_PASSWORD'
];
for (const name of required) {
	if (!process.env[name]) throw new Error(`Missing required exhaustive-flow setting: ${name}`);
}

const target = new URL(process.env.TARGET_URL);
if (target.protocol !== 'https:' || target.pathname !== '/' || target.search || target.hash) {
	throw new Error('TARGET_URL must be a clean HTTPS origin');
}

const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.STAGING_AUTHORIZED_EMAIL;
const password = process.env.STAGING_AUTHORIZED_PASSWORD;
const reportPath =
	process.env.REAL_APP_EXHAUSTIVE_REPORT_PATH ?? '/tmp/real-app-exhaustive-report.json';
const evidenceDir =
	process.env.REAL_APP_EXHAUSTIVE_EVIDENCE_DIR ?? '/tmp/real-app-exhaustive-evidence';
const runToken = `rx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const notebookName = `Exaustivo ${runToken}`;
const destinationNotebookName = `Destino ${runToken}`;
const pdfFilename = `fuzzy-${runToken}.pdf`;
const pdfText = `Eletromagnetismo aplicado ao campo magnetico. Marcador ${runToken}`;
const organizedTitle = `Documento organizado ${runToken}`;
const tagName = `Tag ${runToken}`;
const renamedTagName = `Tag renomeada ${runToken}`;

const report = {
	target: target.origin,
	targetSha: process.env.TARGET_SHA ?? null,
	startedAt: new Date().toISOString(),
	finishedAt: null,
	status: 'running',
	stages: [],
	created: { notebooks: [], documents: [] },
	browser: { pageErrors: [], serverErrors: [] },
	blocked: [
		{
			feature: 'Google Picker: seleção humana de arquivo externo',
			reason:
				'A UI do Google exige uma sessão Google/consentimento interativo externo ao navegador autenticado do CI; contratos, bootstrap OAuth e backend Drive são verificados por outros gates.'
		},
		{
			feature: 'Worker OCR em hardware físico',
			reason:
				'O runner não possui o computador do usuário, Secret Service/Ollama/GPU reais; pareamento, autenticação, leases, spool, engine e protocolo são cobertos pelos gates de staging/unitários.'
		}
	]
};

function safeError(error) {
	return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function stage(name, status, detail = null) {
	const previous = report.stages.find((item) => item.name === name);
	const entry = { name, status, at: new Date().toISOString(), ...(detail ? { detail } : {}) };
	if (previous) Object.assign(previous, entry);
	else report.stages.push(entry);
}

async function persistReport() {
	await mkdir(path.dirname(reportPath), { recursive: true });
	await mkdir(evidenceDir, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function waitForRow(client, table, filters, { timeoutMs = 90_000, intervalMs = 1_200 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let query = client.from(table).select('*');
		for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
		const { data, error } = await query.limit(1).maybeSingle();
		if (error) throw error;
		if (data) return data;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(`Timed out waiting for ${table} row`);
}

async function waitForNativeText(client, documentId) {
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		const { data, error } = await client
			.from('pages')
			.select('id,normalized_text,status')
			.eq('document_id', documentId)
			.order('page_number', { ascending: true })
			.limit(10);
		if (error) throw error;
		const page = (data ?? []).find((row) => row.normalized_text?.includes('eletromagnetismo'));
		if (page) return page;
		await new Promise((resolve) => setTimeout(resolve, 1_500));
	}
	throw new Error('Imported native PDF text never became searchable');
}

async function makePdf() {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const page = pdf.addPage([612, 792]);
	page.drawText(pdfText, { x: 48, y: 690, size: 18, font, color: rgb(0, 0, 0) });
	page.drawText('Teste de busca tolerante a pequenos erros de OCR.', {
		x: 48,
		y: 650,
		size: 12,
		font,
		color: rgb(0, 0, 0)
	});
	return Buffer.from(await pdf.save());
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
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20_000 });
}

async function assertNoVisibleFailure(page, context) {
	const alert = page.locator('[role="alert"]:visible').first();
	if (await alert.count()) {
		const text = (await alert.innerText()).trim();
		if (text) throw new Error(`${context} exposed an alert: ${text.slice(0, 300)}`);
	}
}

async function openRoute(page, route, expectedHeading) {
	await page.goto(new URL(route, target).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	await page.getByRole('heading', { name: expectedHeading, exact: true }).waitFor({
		state: 'visible',
		timeout: 25_000
	});
	await assertNoVisibleFailure(page, route);
}

async function createNotebookThroughUi(page, name) {
	await openRoute(page, '/notebooks/', 'Cadernos');
	await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
	await page.locator('form.new-notebook input').fill(name);
	await page.locator('form.new-notebook textarea').fill(`Criado pelo gate exaustivo ${runToken}`);
	await page.getByRole('button', { name: 'Criar caderno', exact: true }).click();
	await page
		.getByText(name, { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
}

async function cleanup(client) {
	for (const documentId of [...new Set(report.created.documents)]) {
		const { error } = await client.functions.invoke('delete-document', {
			body: { documentId }
		});
		if (error) throw error;
	}
	for (const notebookId of [...new Set(report.created.notebooks)].reverse()) {
		const { error } = await client.from('notebooks').delete().eq('id', notebookId);
		if (error) throw error;
	}
}

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
let browser;
let context;
let page;

try {
	stage('backend-auth', 'running');
	const { error: authError } = await client.auth.signInWithPassword({ email, password });
	if (authError) throw authError;
	stage('backend-auth', 'pass');

	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({
		acceptDownloads: true,
		viewport: { width: 1440, height: 1000 }
	});
	page = await context.newPage();
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('response', (response) => {
		if (response.status() >= 500) {
			const url = new URL(response.url());
			if (url.origin === target.origin || url.origin === new URL(supabaseUrl).origin) {
				report.browser.serverErrors.push(
					`${response.status()} ${url.origin}${url.pathname}`.slice(0, 500)
				);
			}
		}
	});

	stage('real-login', 'running');
	await login(page);
	stage('real-login', 'pass');

	stage('advanced-route-sweep', 'running');
	for (const [route, heading] of [
		['/library/tags/', 'Tags'],
		['/library/organize/', 'Organizar documentos'],
		['/drive/', 'Arquivos no Drive'],
		['/drive/conflicts/', 'Conflitos do Google Drive'],
		['/drive/jobs/', 'Mudanças locais'],
		['/settings/computers/', 'Computadores'],
		['/settings/computers/queue/', 'Fila desktop']
	]) {
		await openRoute(page, route, heading);
	}
	stage('advanced-route-sweep', 'pass');

	stage('notebook-fixtures', 'running');
	await createNotebookThroughUi(page, notebookName);
	await createNotebookThroughUi(page, destinationNotebookName);
	const notebook = await waitForRow(client, 'notebooks', { name: notebookName });
	const destinationNotebook = await waitForRow(client, 'notebooks', {
		name: destinationNotebookName
	});
	report.created.notebooks.push(notebook.id, destinationNotebook.id);
	stage('notebook-fixtures', 'pass');

	stage('native-pdf-fixture', 'running');
	await page.goto(new URL(`/import/?notebook=${notebook.id}`, target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page
		.locator('input[type="file"][accept*="application/pdf"]')
		.first()
		.setInputFiles({
			name: pdfFilename,
			mimeType: 'application/pdf',
			buffer: await makePdf()
		});
	await page
		.getByText(/arquivo\(s\) adicionados à fila global/i)
		.waitFor({ state: 'visible', timeout: 25_000 });
	const imported = await waitForRow(client, 'documents', { original_filename: pdfFilename });
	report.created.documents.push(imported.id);
	await waitForNativeText(client, imported.id);
	stage('native-pdf-fixture', 'pass');

	stage('library-date-filter', 'running');
	await openRoute(page, '/library/', 'Biblioteca');
	await page.getByLabel('Caderno', { exact: true }).selectOption(notebook.id);
	await page
		.getByText(imported.title, { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByLabel('De', { exact: true }).fill('2099-01-01');
	await page
		.getByText('Nenhum documento neste recorte', { exact: true })
		.waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByLabel('De', { exact: true }).fill('');
	await page
		.getByText(imported.title, { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	stage('library-date-filter', 'pass');

	stage('batch-organize', 'running');
	await openRoute(page, '/library/organize/', 'Organizar documentos');
	const organizationTitleInput = page.getByDisplayValue(imported.title, { exact: true }).first();
	await organizationTitleInput.waitFor({ state: 'visible', timeout: 20_000 });
	const organizationRow = organizationTitleInput.locator('xpath=ancestor::article[1]');
	await organizationTitleInput.fill(organizedTitle);
	await organizationRow.locator('select').selectOption(destinationNotebook.id);
	await organizationRow.getByRole('button', { name: 'Salvar', exact: true }).click();
	await organizationRow
		.getByText('Salvo', { exact: true })
		.waitFor({ state: 'visible', timeout: 20_000 });
	const { data: organized, error: organizedError } = await client
		.from('documents')
		.select('title,notebook_id')
		.eq('id', imported.id)
		.single();
	if (organizedError) throw organizedError;
	if (organized.title !== organizedTitle || organized.notebook_id !== destinationNotebook.id) {
		throw new Error('Batch organization was not persisted');
	}
	stage('batch-organize', 'pass');

	stage('tags-crud-membership', 'running');
	await openRoute(page, '/library/tags/', 'Tags');
	await page.locator('input[placeholder^="Nova tag"]').fill(tagName);
	await page.getByRole('button', { name: 'Criar tag', exact: true }).click();
	await page
		.getByText('Tag criada.', { exact: true })
		.waitFor({ state: 'visible', timeout: 20_000 });
	const documentMembershipRow = page
		.locator('ul.documents li')
		.filter({ hasText: organizedTitle })
		.first();
	await documentMembershipRow.waitFor({ state: 'visible', timeout: 20_000 });
	await documentMembershipRow.locator('input[type="checkbox"]').check();
	const tagRows = await client.rpc('list_tags');
	if (tagRows.error) throw tagRows.error;
	const createdTag = (tagRows.data ?? []).find((item) => item.name === tagName);
	if (!createdTag || createdTag.document_count !== 1)
		throw new Error('Tag membership was not persisted');
	page.once('dialog', (dialog) => dialog.accept(renamedTagName));
	await page.getByRole('button', { name: 'Renomear', exact: true }).click();
	await page
		.getByText('Tag renomeada.', { exact: true })
		.waitFor({ state: 'visible', timeout: 20_000 });
	await page
		.getByText(renamedTagName, { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Excluir', exact: true }).click();
	await page
		.getByText('Tag excluída.', { exact: true })
		.waitFor({ state: 'visible', timeout: 20_000 });
	const tagsAfterDelete = await client.rpc('list_tags');
	if (tagsAfterDelete.error) throw tagsAfterDelete.error;
	if ((tagsAfterDelete.data ?? []).some((item) => item.name === renamedTagName)) {
		throw new Error('Deleted tag remained in the backend');
	}
	stage('tags-crud-membership', 'pass');

	stage('fuzzy-search', 'running');
	await page.goto(new URL('/search/?q=eletromagnetizmo', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	const fuzzyResult = page
		.locator('section.results li')
		.filter({ hasText: organizedTitle })
		.first();
	await fuzzyResult.waitFor({ state: 'visible', timeout: 45_000 });
	await fuzzyResult.locator('a').click();
	await page
		.getByText(/Aberto a partir da busca por/)
		.waitFor({ state: 'visible', timeout: 20_000 });
	stage('fuzzy-search', 'pass');

	stage('desktop-ocr-management-ui', 'running');
	await openRoute(page, '/settings/computers/', 'Computadores');
	await page.getByRole('button', { name: /Gerar (outro )?código/ }).click();
	const pairingRegion = page.getByRole('region', { name: 'Código de pareamento ativo' });
	await pairingRegion.waitFor({ state: 'visible', timeout: 30_000 });
	const pairingText = await pairingRegion.locator('code.pairing-code').innerText();
	if (!/^\S{4,}$/.test(pairingText.trim()))
		throw new Error('Pairing code UI did not expose a valid one-time code');
	stage(
		'desktop-ocr-management-ui',
		'pass',
		'Código de uso único criado e exibido sem registrá-lo na evidência.'
	);

	stage('pwa-offline-shell', 'running');
	await openRoute(page, '/settings/', 'Configurações');
	await page.evaluate(async () => {
		if (!('serviceWorker' in navigator)) throw new Error('Service Worker API unavailable');
		await navigator.serviceWorker.ready;
	});
	if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
		await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
		await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
			timeout: 20_000
		});
	}
	await context.setOffline(true);
	await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
	await page
		.getByRole('heading', { name: 'Configurações', exact: true })
		.waitFor({ state: 'visible', timeout: 20_000 });
	await context.setOffline(false);
	await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
	stage('pwa-offline-shell', 'pass');

	if (report.browser.pageErrors.length > 0) {
		throw new Error(`Browser page errors observed: ${report.browser.pageErrors.join(' | ')}`);
	}
	if (report.browser.serverErrors.length > 0) {
		throw new Error(`Server 5xx responses observed: ${report.browser.serverErrors.join(' | ')}`);
	}

	stage('synthetic-cleanup', 'running');
	await cleanup(client);
	report.created.documents = [];
	report.created.notebooks = [];
	stage('synthetic-cleanup', 'pass');

	report.status = 'pass';
} catch (error) {
	report.status = 'fail';
	report.error = safeError(error);
	if (page) {
		await mkdir(evidenceDir, { recursive: true });
		await page
			.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: true })
			.catch(() => undefined);
	}
	try {
		await cleanup(client);
	} catch (cleanupError) {
		report.cleanupError = safeError(cleanupError);
	}
	throw error;
} finally {
	report.finishedAt = new Date().toISOString();
	await persistReport();
	await context?.setOffline(false).catch(() => undefined);
	await browser?.close().catch(() => undefined);
	await client.auth.signOut().catch(() => undefined);
}