import { mkdir, writeFile } from 'node:fs/promises';
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
	if (!process.env[name]) throw new Error(`Missing required real-app-flow setting: ${name}`);
}

const target = new URL(process.env.TARGET_URL);
if (target.protocol !== 'https:' || target.pathname !== '/' || target.search || target.hash) {
	throw new Error('TARGET_URL must be a clean HTTPS origin');
}
const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.STAGING_AUTHORIZED_EMAIL;
const password = process.env.STAGING_AUTHORIZED_PASSWORD;
const reportPath = process.env.REAL_APP_REPORT_PATH ?? '/tmp/real-app-flow-report.json';
const evidenceDir = process.env.REAL_APP_EVIDENCE_DIR ?? '/tmp/real-app-flow-evidence';
const runToken = `rf-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const notebookName = `Teste real ${runToken}`;
const pdfFilename = `real-flow-${runToken}.pdf`;
const pdfTextToken = `FICHARIO PDF ${runToken}`;
const imageFilename = `real-ocr-${runToken}.png`;
const imageTextToken = `FICHARIO OCR ${runToken}`;
const startedAt = new Date().toISOString();

const report = {
	schemaVersion: 1,
	target: target.origin,
	runToken,
	startedAt,
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], consoleErrors: [], serverErrors: [] },
	created: { notebooks: [], documents: [], importSessions: [] },
	cleanup: { documents: 'pending', notebooks: 'pending', importSessions: 'pending' },
	error: null
};

function stage(name, status, detail = null) {
	report.stages.push({ name, status, detail, at: new Date().toISOString() });
}

function safeError(error) {
	if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 800);
	return String(error).slice(0, 800);
}

async function persistReport() {
	report.finishedAt = new Date().toISOString();
	await mkdir(evidenceDir, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function snapshotIds(client, table) {
	const { data, error } = await client.from(table).select('id').limit(10_000);
	if (error || !Array.isArray(data)) throw new Error(`Could not snapshot ${table}`);
	return new Set(data.map((row) => row.id));
}

async function newlyCreatedIds(client, table, before) {
	const { data, error } = await client.from(table).select('id').limit(10_000);
	if (error || !Array.isArray(data)) throw new Error(`Could not enumerate ${table} during cleanup`);
	return data.map((row) => row.id).filter((id) => !before.has(id));
}

async function waitForRow(client, table, filters, { timeoutMs = 90_000, intervalMs = 1_500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let query = client.from(table).select('*');
		for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
		const { data, error } = await query.limit(1).maybeSingle();
		if (error) throw new Error(`Could not read ${table}`);
		if (data) return data;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(`Timed out waiting for ${table}`);
}

async function waitForOcr(client, documentId, timeoutMs = 300_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data: pages, error: pagesError } = await client
			.from('pages')
			.select('id,status,page_number')
			.eq('document_id', documentId)
			.order('page_number');
		if (pagesError) throw new Error('Could not read OCR pages');
		const pageIds = (pages ?? []).map((page) => page.id);
		if (pageIds.length > 0) {
			const { data: jobs, error: jobsError } = await client
				.from('ocr_jobs')
				.select('id,status,last_error_code,last_error_message,attempt_count,page_id')
				.in('page_id', pageIds);
			if (jobsError) throw new Error('Could not read OCR jobs');
			if ((jobs ?? []).some((job) => job.status === 'failed')) {
				const failed = jobs.find((job) => job.status === 'failed');
				throw new Error(
					`OCR job failed: ${failed?.last_error_code ?? 'unknown'} ${failed?.last_error_message ?? ''}`
				);
			}
			if (
				(jobs ?? []).length > 0 &&
				jobs.every((job) => ['complete', 'needs_review'].includes(job.status))
			) {
				return { pages, jobs };
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 4_000));
	}
	throw new Error('Background OCR did not finish within five minutes');
}

async function makePdf() {
	const pdf = await PDFDocument.create();
	pdf.setTitle(`Fluxo real ${runToken}`);
	pdf.setSubject('Fichário deployed end-to-end verification');
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const page = pdf.addPage([612, 792]);
	page.drawText(pdfTextToken, { x: 48, y: 680, size: 24, font, color: rgb(0, 0, 0) });
	page.drawText('Texto nativo para validar importação, indexação e busca.', {
		x: 48,
		y: 635,
		size: 15,
		font,
		color: rgb(0, 0, 0)
	});
	return Buffer.from(await pdf.save());
}

async function makeOcrPng(context) {
	const page = await context.newPage();
	try {
		await page.setViewportSize({ width: 1400, height: 900 });
		await page.setContent(
			`<!doctype html><html><body style="margin:0;background:white;color:black;font-family:Arial,sans-serif"><main style="padding:100px"><h1 style="font-size:72px;margin:0 0 50px">${imageTextToken}</h1><p style="font-size:44px;line-height:1.45">Leitura real do Gemini para verificar OCR, fila em segundo plano e pesquisa textual.</p><p style="font-size:38px">Código ${runToken}</p></main></body></html>`
		);
		return await page.screenshot({ type: 'png', fullPage: true });
	} finally {
		await page.close();
	}
}

async function assertNoVisibleFailure(page, context) {
	const alerts = page.locator('[role="alert"]:visible');
	const count = await alerts.count();
	for (let index = 0; index < count; index += 1) {
		const text = (await alerts.nth(index).innerText()).trim();
		if (/não foi possível|falhou|erro|indisponível/i.test(text)) {
			throw new Error(`${context} exposed a failure alert: ${text}`);
		}
	}
}

async function navigateAndCheck(page, path, expectedHeading) {
	await page.goto(new URL(path, target).href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	if (new URL(page.url()).pathname.startsWith('/login')) {
		throw new Error(`${path} unexpectedly redirected to login`);
	}
	const heading = page.locator('h1').first();
	await heading.waitFor({ state: 'visible', timeout: 20_000 });
	const text = (await heading.innerText()).trim();
	if (!expectedHeading.test(text)) {
		throw new Error(`${path} rendered an unexpected heading: ${text}`);
	}
	await page.waitForTimeout(400);
	await assertNoVisibleFailure(page, path);
	return text;
}

async function waitForQueueEntry(page, filename, { timeoutMs = 180_000, final = false } = {}) {
	const trigger = page.locator('button[aria-controls="global-import-queue"]');
	await trigger.waitFor({ state: 'visible', timeout: 20_000 });
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	const row = page.locator('#global-import-queue li').filter({ hasText: filename }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	const deadline = Date.now() + timeoutMs;
	let last = '';
	while (Date.now() < deadline) {
		last = (await row.innerText()).trim();
		if (/Cannot perform %TypedArray%|detached or out-of-bounds ArrayBuffer/i.test(last)) {
			throw new Error(`Detached ArrayBuffer regression reproduced for ${filename}: ${last}`);
		}
		if (/Falhou/i.test(last)) throw new Error(`Import failed for ${filename}: ${last}`);
		if (/Concluído|Pronto para revisão|Já existe/i.test(last)) return last;
		if (!final && /Leitura em segundo plano/i.test(last)) return last;
		await page.waitForTimeout(1_500);
	}
	throw new Error(`Timed out waiting for import queue entry ${filename}; last state: ${last}`);
}

async function searchFor(page, text, expectedDocumentText) {
	await page.goto(new URL(`/search/?q=${encodeURIComponent(text)}`, target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	const searchInput = page.locator('input[type="search"]');
	await searchInput.waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
	const results = page.locator('section.results');
	await results.waitFor({ state: 'visible', timeout: 45_000 });
	if (!(await results.innerText()).includes(expectedDocumentText)) {
		throw new Error(`Search did not return the expected document for ${text}`);
	}
	await assertNoVisibleFailure(page, 'search');
}

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
let browser = null;
let context = null;
const before = {};

try {
	stage('backend-auth', 'running');
	const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
		email,
		password
	});
	if (signInError || !signIn.session) throw new Error('Staging credentials could not authenticate');
	stage('backend-auth', 'pass');

	for (const table of ['documents', 'notebooks', 'import_sessions']) {
		before[table] = await snapshotIds(client, table);
	}

	const { data: driveConnection, error: driveError } = await client
		.from('drive_connections')
		.select('status,root_folder_id')
		.maybeSingle();
	if (driveError || driveConnection?.status !== 'connected') {
		throw new Error('The real test account does not have a connected Google Drive');
	}
	stage('drive-backend-connection', 'pass');

	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		locale: 'pt-BR',
		serviceWorkers: 'allow'
	});
	const page = await context.newPage();
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') report.browser.consoleErrors.push(message.text().slice(0, 800));
	});
	page.on('response', (response) => {
		const url = new URL(response.url());
		if (
			response.status() >= 500 &&
			(url.origin === target.origin || url.origin === new URL(supabaseUrl).origin)
		) {
			report.browser.serverErrors.push(`${response.status()} ${url.origin}${url.pathname}`);
		}
	});

	stage('real-login', 'running');
	await page.goto(new URL('/login/', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(password);
	await page.getByRole('button', { name: 'Entrar', exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20_000 });
	stage('real-login', 'pass');

	stage('route-sweep', 'running');
	for (const [path, heading] of [
		['/', /Encontre a página certa/i],
		['/library/', /Biblioteca/i],
		['/notebooks/', /Cadernos/i],
		['/import/', /Adicionar ao fichário/i],
		['/search/', /Pesquisar no fichário/i],
		['/review/', /Revis/i],
		['/drive/', /Arquivos no Drive/i],
		['/settings/', /Configura/i],
		['/coverage/', /Cobertura/i]
	]) {
		await navigateAndCheck(page, path, heading);
	}
	stage('route-sweep', 'pass');

	stage('notebook-create', 'running');
	await page.goto(new URL('/notebooks/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
	await page.getByLabel('Nome', { exact: true }).fill(notebookName);
	await page
		.getByLabel('Descrição opcional', { exact: true })
		.fill(`Criado pelo fluxo real ${runToken}`);
	await page.getByRole('button', { name: 'Criar caderno', exact: true }).click();
	await page
		.getByText(notebookName, { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	const { data: notebook, error: notebookError } = await client
		.from('notebooks')
		.select('id,name')
		.eq('name', notebookName)
		.maybeSingle();
	if (notebookError || !notebook) throw new Error('Notebook creation was not persisted');
	report.created.notebooks.push(notebook.id);
	await navigateAndCheck(page, `/notebooks/${notebook.id}/`, new RegExp(runToken, 'i'));
	stage('notebook-create', 'pass');

	stage('native-pdf-import', 'running');
	await page.goto(new URL(`/import/?notebook=${notebook.id}`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	const pdfInput = page.locator('input[type="file"][accept*="application/pdf"]').first();
	await pdfInput.setInputFiles({
		name: pdfFilename,
		mimeType: 'application/pdf',
		buffer: await makePdf()
	});
	await page.getByText(/arquivo\(s\) adicionados à fila global/i).waitFor({
		state: 'visible',
		timeout: 20_000
	});
	const pdfQueueState = await waitForQueueEntry(page, pdfFilename, { timeoutMs: 180_000 });
	const pdfDocument = await waitForRow(
		client,
		'documents',
		{ original_filename: pdfFilename },
		{ timeoutMs: 90_000 }
	);
	report.created.documents.push(pdfDocument.id);
	if (!['ready', 'partially_ready', 'needs_review', 'processing'].includes(pdfDocument.status)) {
		throw new Error(`Unexpected PDF document status: ${pdfDocument.status}`);
	}
	stage('native-pdf-import', 'pass', pdfQueueState.replace(/\s+/g, ' ').slice(0, 240));

	stage('native-pdf-search', 'running');
	await searchFor(page, runToken, pdfDocument.title);
	stage('native-pdf-search', 'pass');

	stage('image-ocr-import', 'running');
	const imageBuffer = await makeOcrPng(context);
	await page.goto(new URL(`/import/?notebook=${notebook.id}`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	const imageInput = page.locator('input[type="file"][accept*="image/jpeg"]').first();
	await imageInput.setInputFiles({
		name: imageFilename,
		mimeType: 'image/png',
		buffer: imageBuffer
	});
	await page.getByText(/arquivo\(s\) adicionados à fila global/i).waitFor({
		state: 'visible',
		timeout: 20_000
	});
	await waitForQueueEntry(page, imageFilename, { timeoutMs: 180_000 });
	const imageDocument = await waitForRow(
		client,
		'documents',
		{ original_filename: imageFilename },
		{ timeoutMs: 120_000 }
	);
	report.created.documents.push(imageDocument.id);
	const ocrState = await waitForOcr(client, imageDocument.id, 300_000);
	const finalImageQueue = await waitForQueueEntry(page, imageFilename, {
		timeoutMs: 40_000,
		final: true
	});
	stage(
		'image-ocr-import',
		'pass',
		`${ocrState.jobs.map((job) => job.status).join(',')} · ${finalImageQueue.replace(/\s+/g, ' ').slice(0, 180)}`
	);

	stage('ocr-search', 'running');
	await searchFor(page, runToken, imageDocument.title);
	stage('ocr-search', 'pass');

	stage('post-import-routes', 'running');
	await navigateAndCheck(page, `/documents/${pdfDocument.id}/`, /.+/);
	await navigateAndCheck(page, `/documents/${imageDocument.id}/`, /.+/);
	await navigateAndCheck(page, '/review/', /Revis/i);
	await navigateAndCheck(page, '/coverage/', /Cobertura/i);
	await navigateAndCheck(page, '/drive/', /Arquivos no Drive/i);
	stage('post-import-routes', 'pass');

	await page
		.screenshot({ path: `${evidenceDir}/final.png`, fullPage: true })
		.catch(() => undefined);
	if (report.browser.pageErrors.length > 0) {
		throw new Error(`Browser page errors detected: ${report.browser.pageErrors.join(' | ')}`);
	}
	if (report.browser.serverErrors.length > 0) {
		throw new Error(`Server 5xx responses detected: ${report.browser.serverErrors.join(' | ')}`);
	}

	report.status = 'pass';
} catch (error) {
	report.status = 'fail';
	report.error = safeError(error);
	stage('failure', 'fail', report.error);
	if (context) {
		const pages = context.pages();
		await pages[0]
			?.screenshot({ path: `${evidenceDir}/failure.png`, fullPage: true })
			.catch(() => undefined);
	}
	process.exitCode = 1;
} finally {
	try {
		const documentIds = before.documents
			? await newlyCreatedIds(client, 'documents', before.documents)
			: [];
		report.created.documents = [...new Set([...report.created.documents, ...documentIds])];
		for (const documentId of documentIds) {
			const { error } = await client.functions.invoke('delete-document', { body: { documentId } });
			if (error) throw error;
		}
		report.cleanup.documents = 'pass';
	} catch (error) {
		report.cleanup.documents = `fail: ${safeError(error)}`;
		if (report.status === 'pass') {
			report.status = 'fail';
			report.error = 'Synthetic document cleanup failed';
			process.exitCode = 1;
		}
	}

	try {
		const notebookIds = before.notebooks
			? await newlyCreatedIds(client, 'notebooks', before.notebooks)
			: [];
		report.created.notebooks = [...new Set([...report.created.notebooks, ...notebookIds])];
		for (const notebookId of notebookIds) {
			const { data, error } = await client.rpc('delete_notebook', {
				target_notebook_id: notebookId
			});
			if (error || data !== true) throw error ?? new Error('delete_notebook rejected cleanup');
		}
		report.cleanup.notebooks = 'pass';
	} catch (error) {
		report.cleanup.notebooks = `fail: ${safeError(error)}`;
		if (report.status === 'pass') {
			report.status = 'fail';
			report.error = 'Synthetic notebook cleanup failed';
			process.exitCode = 1;
		}
	}

	try {
		const sessionIds = before.import_sessions
			? await newlyCreatedIds(client, 'import_sessions', before.import_sessions)
			: [];
		report.created.importSessions = sessionIds;
		if (sessionIds.length > 0) {
			const { error } = await client.from('import_sessions').delete().in('id', sessionIds);
			if (error) throw error;
		}
		report.cleanup.importSessions = 'pass';
	} catch (error) {
		report.cleanup.importSessions = `fail: ${safeError(error)}`;
		if (report.status === 'pass') {
			report.status = 'fail';
			report.error = 'Synthetic import-session cleanup failed';
			process.exitCode = 1;
		}
	}

	await client.auth.signOut().catch(() => undefined);
	await context?.close().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	await persistReport();
	console.log(`Real deployed app flow: ${report.status.toUpperCase()} (${target.origin})`);
}
