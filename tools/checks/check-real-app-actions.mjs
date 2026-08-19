import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { chromium } from 'playwright';

const required = [
	'TARGET_URL',
	'STAGING_SUPABASE_URL',
	'STAGING_SUPABASE_PUBLISHABLE_KEY',
	'STAGING_AUTHORIZED_EMAIL',
	'STAGING_AUTHORIZED_PASSWORD'
];
for (const name of required) {
	if (!process.env[name]) throw new Error(`Missing required real-app-action setting: ${name}`);
}

const target = new URL(process.env.TARGET_URL);
if (target.protocol !== 'https:' || target.pathname !== '/' || target.search || target.hash) {
	throw new Error('TARGET_URL must be a clean HTTPS origin');
}

const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.STAGING_AUTHORIZED_EMAIL;
const password = process.env.STAGING_AUTHORIZED_PASSWORD;
const reportPath = process.env.REAL_APP_ACTION_REPORT_PATH ?? '/tmp/real-app-action-report.json';
const evidenceDir = process.env.REAL_APP_ACTION_EVIDENCE_DIR ?? '/tmp/real-app-action-evidence';
const runToken = `ra-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const notebookName = `Ações reais ${runToken}`;
const childNotebookName = `Subcaderno real ${runToken}`;
const pdfFilename = `actions-${runToken}.pdf`;
const pdfTextToken = `FICHARIO ACOES ${runToken}`;

const report = {
	schemaVersion: 3,
	target: target.origin,
	runToken,
	startedAt: new Date().toISOString(),
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], serverErrors: [] },
	created: { notebooks: [], documents: [] },
	cleanup: { documents: 'pending', notebooks: 'pending' },
	error: null
};

function stage(name, status, detail = null) {
	report.stages.push({ name, status, detail, at: new Date().toISOString() });
}

function safeError(error) {
	return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 800) : String(error).slice(0, 800);
}

async function persistReport() {
	report.finishedAt = new Date().toISOString();
	await mkdir(evidenceDir, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function waitForRow(client, table, filters, timeoutMs = 90_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let query = client.from(table).select('*');
		for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
		const { data, error } = await query.limit(1).maybeSingle();
		if (error) throw error;
		if (data) return data;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Timed out waiting for ${table}`);
}

async function waitForUsableDocument(client, documentId, timeoutMs = 180_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data, error } = await client
			.from('documents')
			.select('id,title,status,notebook_id')
			.eq('id', documentId)
			.maybeSingle();
		if (error) throw error;
		if (!data) throw new Error('Imported document disappeared');
		if (data.status === 'failed') throw new Error('Imported document reached failed status');
		if (['ready', 'partially_ready', 'needs_review'].includes(data.status)) return data;
		await new Promise((resolve) => setTimeout(resolve, 1_500));
	}
	throw new Error('Imported document did not reach a usable status');
}

async function makePdf() {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const page = pdf.addPage([612, 792]);
	page.drawText(pdfTextToken, { x: 48, y: 690, size: 22, font, color: rgb(0, 0, 0) });
	page.drawText('Conservacao de energia em sistemas mecanicos.', {
		x: 48,
		y: 645,
		size: 14,
		font,
		color: rgb(0, 0, 0)
	});
	return Buffer.from(await pdf.save());
}

async function login(page) {
	await page.goto(new URL('/login/', target).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(password);
	await page.getByRole('button', { name: 'Entrar', exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function assertNoFailure(page, context) {
	for (const alert of await page.locator('[role="alert"]:visible').all()) {
		const text = (await alert.innerText()).trim();
		if (/não foi possível|falhou|erro|indisponível/i.test(text)) {
			throw new Error(`${context} exposed failure: ${text}`);
		}
	}
}

async function waitForQueueTerminal(page, filename, timeoutMs = 180_000) {
	const trigger = page.locator('button[aria-controls="global-import-queue"]');
	await trigger.waitFor({ state: 'visible', timeout: 20_000 });
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	const row = page.locator('#global-import-queue li').filter({ hasText: filename }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const text = (await row.innerText()).trim();
		if (/Falhou/i.test(text)) throw new Error(`Import failed: ${text}`);
		if (/Concluído|Já existe/i.test(text)) return text;
		await page.waitForTimeout(1_000);
	}
	throw new Error(`Timed out waiting for queue entry ${filename}`);
}

async function cleanupDocuments(client) {
	const { data, error } = await client.from('documents').select('id').eq('original_filename', pdfFilename);
	if (error) throw error;
	const ids = [...new Set([...(data ?? []).map((row) => row.id), ...report.created.documents])];
	for (const id of ids) {
		const { error: deleteError } = await client.functions.invoke('delete-document', { body: { documentId: id } });
		if (deleteError) throw deleteError;
	}
}

async function cleanupNotebooks(client) {
	const { data, error } = await client
		.from('notebooks')
		.select('id')
		.in('name', [notebookName, childNotebookName]);
	if (error) throw error;
	const ids = [...new Set([...(data ?? []).map((row) => row.id), ...report.created.notebooks])].reverse();
	for (const id of ids) {
		const { data: deleted, error: deleteError } = await client.rpc('delete_notebook', { target_notebook_id: id });
		if (deleteError || deleted !== true) throw deleteError ?? new Error('delete_notebook rejected cleanup');
	}
}

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
let browser = null;
let context = null;

try {
	stage('backend-auth', 'running');
	const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
	if (signInError || !signIn.session) throw new Error('Staging credentials could not authenticate');
	stage('backend-auth', 'pass');

	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
	const page = await context.newPage();
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('response', (response) => {
		if (response.status() >= 500) report.browser.serverErrors.push(`${response.status()} ${response.url()}`.slice(0, 500));
	});

	stage('real-login', 'running');
	await login(page);
	stage('real-login', 'pass');

	stage('notebook-create', 'running');
	await page.goto(new URL('/notebooks/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
	await page.getByLabel('Nome', { exact: true }).fill(notebookName);
	await page.getByLabel('Descrição opcional', { exact: true }).fill(`Teste ${runToken}`);
	await page.getByRole('button', { name: 'Criar caderno', exact: true }).click();
	const notebook = await waitForRow(client, 'notebooks', { name: notebookName });
	report.created.notebooks.push(notebook.id);
	stage('notebook-create', 'pass');

	stage('sub-notebook-create', 'running');
	await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
	await page.getByLabel('Nome', { exact: true }).fill(childNotebookName);
	await page.locator('form.new-notebook select').selectOption(notebook.id);
	await page.getByRole('button', { name: 'Criar caderno', exact: true }).click();
	const childNotebook = await waitForRow(client, 'notebooks', { name: childNotebookName });
	report.created.notebooks.push(childNotebook.id);
	stage('sub-notebook-create', 'pass');

	stage('pdf-import', 'running');
	await page.goto(new URL('/import/', target).href, { waitUntil: 'domcontentloaded' });
	await page
		.locator('input[type="file"][accept*="application/pdf"]')
		.first()
		.setInputFiles({ name: pdfFilename, mimeType: 'application/pdf', buffer: await makePdf() });
	await page.getByText(/arquivo adicionado\./i).waitFor({ state: 'visible', timeout: 20_000 });
	const imported = await waitForRow(client, 'documents', { original_filename: pdfFilename });
	report.created.documents.push(imported.id);
	const usableDocument = await waitForUsableDocument(client, imported.id);
	await waitForQueueTerminal(page, pdfFilename);
	stage('pdf-import', 'pass', usableDocument.status);

	stage('library-to-notebook', 'running');
	await page.goto(new URL(`/notebooks/${notebook.id}/`, target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Da biblioteca', exact: true }).click();
	const picker = page.locator('section.library-picker');
	await picker.getByLabel('Buscar na biblioteca', { exact: true }).fill(usableDocument.title);
	const row = picker.locator('li').filter({ hasText: usableDocument.title }).first();
	await row.getByRole('button', { name: 'Adicionar', exact: true }).click();
	const moved = await waitForRow(client, 'documents', { id: imported.id, notebook_id: notebook.id });
	if (!moved) throw new Error('Document was not moved to notebook');
	stage('library-to-notebook', 'pass');

	stage('document-original-first', 'running');
	await page.goto(new URL(`/documents/${imported.id}/`, target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('heading', { name: 'Original', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
	if ((await page.getByLabel(/Texto corrigido/i).count()) > 0) {
		throw new Error('Removed manual review editor is visible');
	}
	if ((await page.getByText(/Pronto para revisão|Para revisar/i).count()) > 0) {
		throw new Error('Removed review semantics are visible in document detail');
	}
	stage('document-original-first', 'pass');

	stage('search-original', 'running');
	await page.goto(new URL(`/search/?q=${encodeURIComponent(runToken)}`, target).href, { waitUntil: 'domcontentloaded' });
	const result = page.locator(`section.results a[href^="/documents/${imported.id}/"]`).first();
	await result.waitFor({ state: 'visible', timeout: 45_000 });
	await result.click();
	await page.getByText(/Aberto a partir da busca por/i).waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByRole('heading', { name: 'Original', exact: true }).waitFor({ state: 'visible' });
	stage('search-original', 'pass');

	stage('library-filters', 'running');
	await page.goto(new URL('/library/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Caderno', { exact: true }).selectOption(notebook.id);
	await page.getByLabel('Tipo', { exact: true }).selectOption('pdf');
	await page.getByText(usableDocument.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
	await assertNoFailure(page, 'library filters');
	stage('library-filters', 'pass');

	stage('settings-export', 'running');
	await page.goto(new URL('/settings/', target).href, { waitUntil: 'domcontentloaded' });
	const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
	await page.getByRole('button', { name: 'Baixar cópia', exact: true }).click();
	const download = await downloadPromise;
	if (!download.suggestedFilename().endsWith('.json')) throw new Error('Portable export is not JSON');
	const downloadedPath = await download.path();
	if (!downloadedPath) throw new Error('Portable export did not create a file');
	const exported = JSON.parse(await readFile(downloadedPath, 'utf8'));
	if (!exported || typeof exported !== 'object') throw new Error('Portable export JSON is invalid');
	stage('settings-export', 'pass');

	stage('mobile-responsive-sweep', 'running');
	const mobile = await context.newPage();
	await mobile.setViewportSize({ width: 390, height: 844 });
	for (const route of ['/library/', '/notebooks/', '/import/', '/search/', '/drive/', '/settings/', '/coverage/']) {
		await mobile.goto(new URL(route, target).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
		await mobile.locator('h1').first().waitFor({ state: 'visible', timeout: 20_000 });
		const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		if (overflow > 2) throw new Error(`${route} overflows mobile viewport by ${overflow}px`);
		await assertNoFailure(mobile, `mobile ${route}`);
	}
	await mobile.close();
	stage('mobile-responsive-sweep', 'pass');

	stage('document-delete', 'running');
	await page.goto(new URL(`/documents/${imported.id}/`, target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Excluir', exact: true }).click();
	const deleteDialog = page.getByRole('alertdialog');
	await deleteDialog.getByRole('button', { name: 'Excluir', exact: true }).click();
	await page.waitForURL((url) => /\/library\/?$/.test(url.pathname), { timeout: 45_000 });
	const { data: deletedDocument, error: deletedError } = await client
		.from('documents')
		.select('id')
		.eq('id', imported.id)
		.maybeSingle();
	if (deletedError || deletedDocument !== null) throw new Error('UI document deletion was not persisted');
	report.created.documents = report.created.documents.filter((id) => id !== imported.id);
	stage('document-delete', 'pass');

	if (report.browser.pageErrors.length > 0) throw new Error(`Browser page errors: ${report.browser.pageErrors.join(' | ')}`);
	if (report.browser.serverErrors.length > 0) throw new Error(`Server 5xx responses: ${report.browser.serverErrors.join(' | ')}`);
	report.status = 'pass';
} catch (error) {
	report.status = 'fail';
	report.error = safeError(error);
	stage('failure', 'fail', report.error);
	const page = context?.pages()[0];
	await page?.screenshot({ path: `${evidenceDir}/failure.png`, fullPage: true }).catch(() => undefined);
	process.exitCode = 1;
} finally {
	try {
		await cleanupDocuments(client);
		report.cleanup.documents = 'pass';
	} catch (error) {
		report.cleanup.documents = `fail: ${safeError(error)}`;
		process.exitCode = 1;
	}
	try {
		await cleanupNotebooks(client);
		report.cleanup.notebooks = 'pass';
	} catch (error) {
		report.cleanup.notebooks = `fail: ${safeError(error)}`;
		process.exitCode = 1;
	}
	await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
	await context?.close().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	await persistReport();
	console.log(`Real deployed app actions: ${report.status.toUpperCase()} (${target.origin})`);
}
