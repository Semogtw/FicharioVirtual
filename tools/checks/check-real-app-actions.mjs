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
const pdfFilename = `actions-medium-${runToken}.pdf`;
const failedFilename = `actions-failed-${runToken}.pdf`;
const pdfTextToken = `FICHARIO ACOES ${runToken}`;
const correctedToken = `CORRECAO REAL ${runToken}`;
const photoFilename = `ementa-${runToken}.png`;

const report = {
	schemaVersion: 2,
	target: target.origin,
	runToken,
	startedAt: new Date().toISOString(),
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], serverErrors: [] },
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

function trackServerResponse(response) {
	const url = new URL(response.url());
	if (url.origin !== target.origin && url.origin !== new URL(supabaseUrl).origin) return;
	const endpoint = `${url.origin}${url.pathname}`;
	const status = response.status();
	if (status >= 500) {
		report.browser.serverErrors = report.browser.serverErrors.filter(
			(value) => !value.endsWith(endpoint)
		);
		report.browser.serverErrors.push(`${status} ${endpoint}`);
		return;
	}
	if (status >= 200 && status < 300) {
		report.browser.serverErrors = report.browser.serverErrors.filter(
			(value) => !value.endsWith(endpoint)
		);
	}
}

async function persistReport() {
	report.finishedAt = new Date().toISOString();
	await mkdir(evidenceDir, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function waitForRow(client, table, filters, { timeoutMs = 90_000, intervalMs = 1_200 } = {}) {
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

async function waitForDocumentNotebook(client, documentId, notebookId, timeoutMs = 45_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data, error } = await client
			.from('documents')
			.select('id,notebook_id')
			.eq('id', documentId)
			.maybeSingle();
		if (error) throw new Error('Could not inspect document notebook assignment');
		if (data?.notebook_id === notebookId) return;
		await new Promise((resolve) => setTimeout(resolve, 800));
	}
	throw new Error('Document was not attached to the requested notebook');
}

async function openQueue(page) {
	const trigger = page.locator('button[aria-controls="global-import-queue"]');
	await trigger.waitFor({ state: 'visible', timeout: 20_000 });
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	return page.locator('#global-import-queue');
}

async function waitForQueueEntry(page, filename, timeoutMs = 180_000) {
	const queue = await openQueue(page);
	const row = queue.locator('li').filter({ hasText: filename }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	const deadline = Date.now() + timeoutMs;
	let last = '';
	while (Date.now() < deadline) {
		last = (await row.innerText()).trim();
		if (/Cannot perform %TypedArray%|detached or out-of-bounds ArrayBuffer/i.test(last)) {
			throw new Error(`Detached ArrayBuffer regression reproduced for ${filename}: ${last}`);
		}
		if (/Falhou/i.test(last)) throw new Error(`Import failed for ${filename}: ${last}`);
		if (/Concluído|Pronto para revisão|Já existe|Leitura em segundo plano/i.test(last)) return last;
		await page.waitForTimeout(1_500);
	}
	throw new Error(`Timed out waiting for import queue entry ${filename}; last state: ${last}`);
}

async function waitForFailedQueueEntry(page, filename, timeoutMs = 60_000) {
	const queue = await openQueue(page);
	const row = queue.locator('li').filter({ hasText: filename }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const text = await row.innerText();
		if (/Falhou/i.test(text)) return row;
		await page.waitForTimeout(800);
	}
	throw new Error(`Timed out waiting for a deliberate failed import: ${filename}`);
}

async function waitForDocumentTerminal(client, documentId, timeoutMs = 180_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data, error } = await client
			.from('documents')
			.select('id,status,title,original_filename')
			.eq('id', documentId)
			.maybeSingle();
		if (error) throw new Error('Could not inspect imported document');
		if (!data) throw new Error('Imported document disappeared before verification');
		if (data.status === 'failed') throw new Error('Imported document reached failed status');
		if (['ready', 'partially_ready', 'needs_review'].includes(data.status)) return data;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error('Imported document did not reach a usable status');
}

function randomPadding(size) {
	const bytes = new Uint8Array(size);
	for (let offset = 0; offset < bytes.length; offset += 65_536) {
		crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65_536, bytes.length)));
	}
	return bytes;
}

async function makePdf({ padded = true } = {}) {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const page = pdf.addPage([612, 792]);
	page.drawText(pdfTextToken, { x: 48, y: 690, size: 22, font, color: rgb(0, 0, 0) });
	page.drawText('Conservacao de energia e energia cinetica em sistemas mecanicos.', {
		x: 48,
		y: 645,
		size: 14,
		font,
		color: rgb(0, 0, 0)
	});
	if (padded) {
		await pdf.attach(randomPadding(384 * 1024), 'payload.bin', {
			mimeType: 'application/octet-stream',
			description: 'Força um upload real com mais de um chunk de 256 KiB.'
		});
	}
	const buffer = Buffer.from(await pdf.save());
	if (padded && buffer.byteLength <= 256 * 1024) {
		throw new Error(`Medium PDF fixture is too small: ${buffer.byteLength} bytes`);
	}
	return buffer;
}

async function makePng(context, lines) {
	const page = await context.newPage();
	try {
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.setContent(
			`<!doctype html><html><body style="margin:0;background:white;color:#111;font-family:Arial,sans-serif"><main style="padding:70px">${lines
				.map(
					(line, index) =>
						`<p style="font-size:${index === 0 ? 54 : 40}px;margin:0 0 28px">${line}</p>`
				)
				.join('')}</main></body></html>`
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

async function searchFor(page, text, expectedDocumentId, timeoutMs = 60_000) {
	await page.goto(new URL(`/search/?q=${encodeURIComponent(text)}`, target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	const searchInput = page.locator('input[type="search"]');
	await searchInput.waitFor({ state: 'visible', timeout: 20_000 });
	const results = page.locator('section.results');
	const expectedLink = results.locator(`a[href*="/documents/${expectedDocumentId}/"]`).first();
	try {
		await expectedLink.waitFor({ state: 'visible', timeout: timeoutMs });
		return results;
	} catch {
		throw new Error(`Search did not return the expected document for ${text}`);
	}
}

async function cleanupDocuments(client) {
	const { data, error } = await client
		.from('documents')
		.select('id')
		.in('original_filename', [pdfFilename, failedFilename, photoFilename]);
	if (error) throw error;
	const ids = [...new Set([...(data ?? []).map((row) => row.id), ...report.created.documents])];
	report.created.documents = ids;
	for (const documentId of ids) {
		const { error: deleteError } = await client.functions.invoke('delete-document', {
			body: { documentId }
		});
		if (deleteError) throw deleteError;
	}
}

async function cleanupNotebooks(client) {
	const { data, error } = await client
		.from('notebooks')
		.select('id')
		.in('name', [notebookName, childNotebookName]);
	if (error) throw error;
	const tracked = [...report.created.notebooks].reverse();
	const discovered = (data ?? []).map((row) => row.id).filter((id) => !tracked.includes(id));
	const ids = [...tracked, ...discovered];
	report.created.notebooks = [...new Set(ids)];
	for (const notebookId of report.created.notebooks) {
		const { data: deleted, error: deleteError } = await client.rpc('delete_notebook', {
			target_notebook_id: notebookId
		});
		if (deleteError || deleted !== true) {
			throw deleteError ?? new Error('delete_notebook rejected cleanup');
		}
	}
}

async function cleanupImportSessions(client, resumeKeys) {
	if (resumeKeys.size === 0) return;
	const { data, error } = await client
		.from('import_sessions')
		.select('id')
		.in('local_resume_key', [...resumeKeys]);
	if (error) throw error;
	const ids = [...new Set((data ?? []).map((row) => row.id))];
	report.created.importSessions = ids;
	if (ids.length === 0) return;
	const { error: deleteError } = await client.from('import_sessions').delete().in('id', ids);
	if (deleteError) throw deleteError;
}

function captureImportResumeKey(request, resumeKeys) {
	if (request.method() !== 'POST') return;
	const url = new URL(request.url());
	if (
		url.origin !== new URL(supabaseUrl).origin ||
		!url.pathname.endsWith('/rest/v1/import_sessions')
	) {
		return;
	}
	try {
		const payload = request.postDataJSON();
		const rows = Array.isArray(payload) ? payload : [payload];
		for (const row of rows) {
			if (row && typeof row === 'object' && typeof row.local_resume_key === 'string') {
				resumeKeys.add(row.local_resume_key);
			}
		}
	} catch {
		// Deterministic document and notebook cleanup still protects the test account.
	}
}

function recordCleanupFailure(kind, error, message) {
	report.cleanup[kind] = `fail: ${safeError(error)}`;
	if (report.status === 'pass') {
		report.status = 'fail';
		report.error = message;
		process.exitCode = 1;
	}
}

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const importResumeKeys = new Set();
let browser = null;
let context = null;
let syntheticCleaned = false;

try {
	stage('backend-auth', 'running');
	const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
		email,
		password
	});
	if (signInError || !signIn.session) throw new Error('Staging credentials could not authenticate');
	stage('backend-auth', 'pass');

	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		locale: 'pt-BR',
		serviceWorkers: 'allow',
		acceptDownloads: true
	});
	const page = await context.newPage();
	page.on('request', (request) => captureImportResumeKey(request, importResumeKeys));
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('response', trackServerResponse);

	stage('real-login', 'running');
	await login(page);
	stage('real-login', 'pass');

	stage('pwa-shell', 'running');
	await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
	if (!manifestHref) throw new Error('Deployed app does not expose a web app manifest');
	const manifestResponse = await context.request.get(new URL(manifestHref, target).href);
	if (!manifestResponse.ok())
		throw new Error(`Web app manifest returned ${manifestResponse.status()}`);
	stage('pwa-shell', 'pass');

	stage('notebook-create-layout', 'running');
	await page.goto(new URL('/notebooks/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
	const nameField = page.getByLabel('Nome', { exact: true });
	const descriptionField = page.getByLabel('Descrição opcional', { exact: true });
	const parentField = page.getByLabel('Dentro de', { exact: true });
	const boxes = await Promise.all([
		nameField.boundingBox(),
		descriptionField.boundingBox(),
		parentField.boundingBox()
	]);
	if (boxes.some((box) => box === null)) throw new Error('Notebook form fields are not visible');
	const heights = boxes.map((box) => box.height);
	if (Math.max(...heights) - Math.min(...heights) > 2) {
		throw new Error(`Notebook form controls are misaligned: ${heights.join(', ')}`);
	}
	await nameField.fill(notebookName);
	await descriptionField.fill(`Teste funcional ${runToken}`);
	await page.getByRole('button', { name: 'Criar caderno', exact: true }).click();
	const notebook = await waitForRow(client, 'notebooks', { name: notebookName });
	report.created.notebooks.push(notebook.id);
	stage('notebook-create-layout', 'pass', `control heights: ${heights.join('/')}`);

	stage('sub-notebook-create', 'running');
	await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
	await page.getByLabel('Nome', { exact: true }).fill(childNotebookName);
	await page
		.getByLabel('Descrição opcional', { exact: true })
		.fill('Sub-caderno criado pelo fluxo real');
	await page.getByLabel('Dentro de', { exact: true }).selectOption(notebook.id);
	await page.getByRole('button', { name: 'Criar caderno', exact: true }).click();
	const childNotebook = await waitForRow(client, 'notebooks', {
		name: childNotebookName,
		parent_notebook_id: notebook.id
	});
	report.created.notebooks.push(childNotebook.id);
	await page
		.getByRole('heading', { name: 'Sub-cadernos', exact: true })
		.waitFor({ state: 'visible' });
	const childCard = page
		.locator('article.notebook-card')
		.filter({ hasText: childNotebookName })
		.first();
	await childCard.waitFor({ state: 'visible' });
	if (!new RegExp(notebookName, 'i').test(await childCard.innerText())) {
		throw new Error('Sub-notebook UI does not identify its parent notebook');
	}
	stage('sub-notebook-create', 'pass');

	stage('notebook-banner', 'running');
	await page.goto(new URL(`/notebooks/${notebook.id}/`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	await page
		.getByRole('heading', { name: notebookName, exact: true })
		.waitFor({ state: 'visible' });
	const banner = await makePng(context, ['Banner de teste do Fichário', runToken]);
	await page.getByRole('button', { name: '+ Adicionar banner', exact: true }).click();
	const bannerInput = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
	await bannerInput.setInputFiles({
		name: `banner-${runToken}.png`,
		mimeType: 'image/png',
		buffer: banner
	});
	await page.getByRole('button', { name: 'Salvar banner', exact: true }).click();
	await page.getByRole('button', { name: 'Personalizar banner', exact: true }).waitFor({
		state: 'visible',
		timeout: 30_000
	});
	const { data: bannerRow, error: bannerError } = await client
		.from('notebooks')
		.select('banner_path')
		.eq('id', notebook.id)
		.maybeSingle();
	if (bannerError || !bannerRow?.banner_path) throw new Error('Notebook banner was not persisted');
	await page.getByRole('button', { name: 'Personalizar banner', exact: true }).click();
	await page.getByRole('button', { name: 'Remover banner', exact: true }).click();
	await page.getByRole('button', { name: '+ Adicionar banner', exact: true }).waitFor({
		state: 'visible',
		timeout: 30_000
	});
	stage('notebook-banner', 'pass');

	stage('pdf-multichunk-import', 'running');
	await page.goto(new URL('/import/', target).href, { waitUntil: 'domcontentloaded' });
	const mediumPdf = await makePdf();
	await page
		.locator('input[type="file"][accept*="application/pdf"]')
		.first()
		.setInputFiles({ name: pdfFilename, mimeType: 'application/pdf', buffer: mediumPdf });
	await page.getByText(/arquivo\(s\) adicionados à fila global/i).waitFor({
		state: 'visible',
		timeout: 20_000
	});
	const queueState = await waitForQueueEntry(page, pdfFilename);
	const imported = await waitForRow(client, 'documents', { original_filename: pdfFilename });
	report.created.documents.push(imported.id);
	const pdfDocument = await waitForDocumentTerminal(client, imported.id);
	const { data: driveDocument, error: driveDocumentError } = await client
		.from('documents')
		.select('drive_file_id,drive_parent_folder_id,physical_state,notebook_id')
		.eq('id', pdfDocument.id)
		.maybeSingle();
	if (
		driveDocumentError ||
		!driveDocument?.drive_file_id ||
		!driveDocument.drive_parent_folder_id ||
		driveDocument.physical_state !== 'available' ||
		driveDocument.notebook_id !== null
	) {
		throw new Error(
			'Medium PDF was not persisted as an available unassigned Google Drive original'
		);
	}
	stage(
		'pdf-multichunk-import',
		'pass',
		`${mediumPdf.byteLength} bytes; ${queueState.replace(/\s+/g, ' ').slice(0, 180)}`
	);

	stage('library-document-to-notebook', 'running');
	await page.goto(new URL(`/notebooks/${notebook.id}/`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	await page.getByRole('button', { name: 'Da biblioteca', exact: true }).click();
	const picker = page.locator('section.library-picker');
	await picker.waitFor({ state: 'visible', timeout: 20_000 });
	await picker.getByLabel('Buscar na biblioteca', { exact: true }).fill(pdfDocument.title);
	const libraryRow = picker.locator('li').filter({ hasText: pdfDocument.title }).first();
	await libraryRow.waitFor({ state: 'visible', timeout: 30_000 });
	await libraryRow.getByRole('button', { name: 'Adicionar', exact: true }).click();
	await waitForDocumentNotebook(client, pdfDocument.id, notebook.id);
	await page.getByText(pdfDocument.title, { exact: true }).first().waitFor({
		state: 'visible',
		timeout: 30_000
	});
	stage('library-document-to-notebook', 'pass');

	stage('document-original-render', 'running');
	await page.goto(new URL(`/documents/${pdfDocument.id}/`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	const renderedImage = page.locator('.page-image img').first();
	await renderedImage.waitFor({ state: 'visible', timeout: 60_000 });
	const rendered = await renderedImage.evaluate((image) => ({
		complete: image.complete,
		naturalWidth: image.naturalWidth,
		naturalHeight: image.naturalHeight
	}));
	if (!rendered.complete || rendered.naturalWidth < 1 || rendered.naturalHeight < 1) {
		throw new Error(`Drive original did not render: ${JSON.stringify(rendered)}`);
	}
	const renderFailure = page.getByText(/Não foi possível renderizar esta página/i);
	if ((await renderFailure.count()) > 0 && (await renderFailure.first().isVisible())) {
		throw new Error('Document viewer exposed the Drive rendering failure state');
	}
	stage('document-original-render', 'pass', `${rendered.naturalWidth}x${rendered.naturalHeight}`);

	stage('library-filters', 'running');
	await page.goto(new URL('/library/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Caderno', { exact: true }).selectOption(notebook.id);
	await page.getByLabel('Tipo', { exact: true }).selectOption('pdf');
	await page.getByText(pdfDocument.title, { exact: true }).first().waitFor({
		state: 'visible',
		timeout: 30_000
	});
	await assertNoVisibleFailure(page, 'library filters');
	stage('library-filters', 'pass');

	stage('correction-save', 'running');
	await page.goto(new URL(`/documents/${pdfDocument.id}/`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	const correction = `${pdfTextToken}\n${correctedToken}\nConservacao de energia.`;
	const correctionBox = page.getByLabel('Texto corrigido da página 1', { exact: true });
	await correctionBox.fill(correction);
	await page.getByRole('button', { name: 'Salvar agora', exact: true }).click();
	await page.getByText('Salvo', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
	const { data: correctedPage, error: correctedError } = await client
		.from('pages')
		.select('corrected_text,was_manually_reviewed')
		.eq('document_id', pdfDocument.id)
		.eq('page_number', 1)
		.maybeSingle();
	if (
		correctedError ||
		correctedPage?.corrected_text !== correction ||
		!correctedPage.was_manually_reviewed
	) {
		throw new Error('Manual correction was not persisted exactly');
	}
	stage('correction-save', 'pass');

	stage('corrected-search-highlight', 'running');
	const searchResults = await searchFor(page, correctedToken, pdfDocument.id);
	const resultLink = searchResults.locator(`a[href*="/documents/${pdfDocument.id}/"]`).first();
	await resultLink.click();
	await page.waitForURL((url) => url.pathname.includes(`/documents/${pdfDocument.id}/`), {
		timeout: 20_000
	});
	await page
		.getByText(/Aberto a partir da busca por/i)
		.waitFor({ state: 'visible', timeout: 20_000 });
	stage('corrected-search-highlight', 'pass');

	stage('coverage-semantic', 'running');
	await page.goto(new URL('/coverage/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Conteúdos', { exact: true }).fill('Conservação de energia');
	await page.getByRole('button', { name: 'Transformar em campos', exact: true }).click();
	await page.getByLabel('Buscar em', { exact: true }).selectOption(notebook.id);
	await page.getByRole('button', { name: 'Verificar cobertura', exact: true }).click();
	const coverage = page.locator('section.coverage');
	await coverage.waitFor({ state: 'visible', timeout: 120_000 });
	if (!/Conservação de energia/i.test(await coverage.innerText())) {
		throw new Error('Coverage analysis did not preserve the requested topic');
	}
	await assertNoVisibleFailure(page, 'coverage semantic');
	stage('coverage-semantic', 'pass');

	stage('coverage-photo-ocr', 'running');
	const syllabus = await makePng(context, [
		'UNIDADE TESTE',
		'1. Energia cinética',
		'2. Conservação de energia',
		'3. Trabalho mecânico'
	]);
	const photoInput = page
		.locator('section.photo-card input[type="file"][accept="image/jpeg,image/png,image/webp"]')
		.first();
	await photoInput.setInputFiles({ name: photoFilename, mimeType: 'image/png', buffer: syllabus });
	const photoNotice = page.locator('section.photo-card p.photo-notice');
	await photoNotice.waitFor({ state: 'visible', timeout: 180_000 });
	if (!/[1-9]\d* conteúdo\(s\) extraído\(s\)/i.test(await photoNotice.innerText())) {
		throw new Error('Coverage photo OCR did not produce editable topics');
	}
	await assertNoVisibleFailure(page, 'coverage photo OCR');
	stage('coverage-photo-ocr', 'pass');

	stage('failed-import-removal', 'running');
	await page.goto(new URL('/import/', target).href, { waitUntil: 'domcontentloaded' });
	await page.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
		if (route.request().method() === 'POST') await route.abort('failed');
		else await route.continue();
	});
	await page
		.locator('input[type="file"][accept*="application/pdf"]')
		.first()
		.setInputFiles({
			name: failedFilename,
			mimeType: 'application/pdf',
			buffer: await makePdf({ padded: false })
		});
	const failedRow = await waitForFailedQueueEntry(page, failedFilename);
	await failedRow
		.getByRole('button', { name: 'Retomar', exact: true })
		.waitFor({ state: 'visible' });
	await failedRow.getByRole('button', { name: 'Remover', exact: true }).click();
	await failedRow.waitFor({ state: 'detached', timeout: 10_000 });
	await page.unroute('https://www.googleapis.com/upload/drive/v3/files**');
	stage('failed-import-removal', 'pass');

	stage('drive-refresh', 'running');
	await page.goto(new URL('/drive/', target).href, { waitUntil: 'domcontentloaded' });
	const refreshDrive = page.getByRole('button', { name: 'Atualizar', exact: true });
	await refreshDrive.waitFor({ state: 'visible', timeout: 20_000 });
	await refreshDrive.click();
	await page
		.getByText(/Está tudo certo por aqui|encontrado em/i)
		.first()
		.waitFor({
			state: 'visible',
			timeout: 45_000
		});
	await assertNoVisibleFailure(page, 'Drive refresh');
	stage('drive-refresh', 'pass');

	stage('settings-theme-export', 'running');
	await page.goto(new URL('/settings/', target).href, { waitUntil: 'domcontentloaded' });
	const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
	const alternativeTheme = page.locator('[role="radio"][aria-checked="false"]').first();
	await alternativeTheme.click();
	const changedTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
	if (!changedTheme || changedTheme === originalTheme)
		throw new Error('Theme selection did not apply');
	if (originalTheme) {
		const originalOption = page.locator(`[data-theme-option="${originalTheme}"]`);
		if (await originalOption.count()) await originalOption.click();
	}
	const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
	await page.getByRole('button', { name: 'Baixar cópia', exact: true }).click();
	const download = await downloadPromise;
	if (!download.suggestedFilename().endsWith('.json'))
		throw new Error('Portable export is not JSON');
	const downloadedPath = await download.path();
	if (!downloadedPath) throw new Error('Portable export did not create a file');
	const exported = JSON.parse(await readFile(downloadedPath, 'utf8'));
	if (!exported || typeof exported !== 'object') throw new Error('Portable export JSON is invalid');
	stage('settings-theme-export', 'pass');

	stage('mobile-responsive-sweep', 'running');
	const mobile = await context.newPage();
	await mobile.setViewportSize({ width: 390, height: 844 });
	for (const path of [
		'/library/',
		'/notebooks/',
		'/import/',
		'/search/',
		'/review/',
		'/drive/',
		'/settings/',
		'/coverage/'
	]) {
		await mobile.goto(new URL(path, target).href, {
			waitUntil: 'domcontentloaded',
			timeout: 45_000
		});
		await mobile.locator('h1').first().waitFor({ state: 'visible', timeout: 20_000 });
		const overflow = await mobile.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		if (overflow > 2) throw new Error(`${path} overflows mobile viewport by ${overflow}px`);
		await assertNoVisibleFailure(mobile, `mobile ${path}`);
	}
	await mobile.close();
	stage('mobile-responsive-sweep', 'pass');

	stage('document-delete-ui', 'running');
	await page.goto(new URL(`/documents/${pdfDocument.id}/`, target).href, {
		waitUntil: 'domcontentloaded'
	});
	await page.getByRole('button', { name: 'Excluir', exact: true }).click();
	const deleteDialog = page.getByRole('alertdialog');
	await deleteDialog.waitFor({ state: 'visible', timeout: 10_000 });
	await deleteDialog.getByRole('button', { name: 'Excluir', exact: true }).click();
	await page.waitForURL((url) => url.pathname === '/library/' || url.pathname === '/library', {
		timeout: 45_000
	});
	const { data: deletedDocument, error: deletedError } = await client
		.from('documents')
		.select('id')
		.eq('id', pdfDocument.id)
		.maybeSingle();
	if (deletedError || deletedDocument !== null) {
		throw new Error('UI document deletion was not persisted');
	}
	report.created.documents = report.created.documents.filter((id) => id !== pdfDocument.id);
	stage('document-delete-ui', 'pass');

	stage('synthetic-cleanup', 'running');
	await cleanupDocuments(client);
	report.cleanup.documents = 'pass';
	await cleanupImportSessions(client, importResumeKeys);
	report.cleanup.importSessions = 'pass';
	await cleanupNotebooks(client);
	report.cleanup.notebooks = 'pass';
	syntheticCleaned = true;
	stage('synthetic-cleanup', 'pass');

	stage('logout', 'running');
	await page.goto(new URL('/settings/', target).href, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'Sair', exact: true }).click();
	await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 30_000 });
	stage('logout', 'pass');

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
		const page = context.pages()[0];
		await page
			?.screenshot({ path: `${evidenceDir}/failure.png`, fullPage: true })
			.catch(() => undefined);
	}
	process.exitCode = 1;
} finally {
	if (!syntheticCleaned) {
		try {
			await cleanupDocuments(client);
			report.cleanup.documents = 'pass';
		} catch (error) {
			recordCleanupFailure('documents', error, 'Synthetic document cleanup failed');
		}
		try {
			await cleanupImportSessions(client, importResumeKeys);
			report.cleanup.importSessions = 'pass';
		} catch (error) {
			recordCleanupFailure('importSessions', error, 'Synthetic import-session cleanup failed');
		}
		try {
			await cleanupNotebooks(client);
			report.cleanup.notebooks = 'pass';
		} catch (error) {
			recordCleanupFailure('notebooks', error, 'Synthetic notebook cleanup failed');
		}
	}

	await client.auth.signOut().catch(() => undefined);
	await context?.close().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	await persistReport();
	console.log(`Real deployed app actions: ${report.status.toUpperCase()} (${target.origin})`);
}
