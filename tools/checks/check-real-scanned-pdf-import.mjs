import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';

const required = [
	'TARGET_URL',
	'STAGING_SUPABASE_URL',
	'STAGING_SUPABASE_PUBLISHABLE_KEY',
	'STAGING_AUTHORIZED_EMAIL',
	'STAGING_AUTHORIZED_PASSWORD'
];
for (const name of required) {
	if (!process.env[name]) throw new Error(`Missing required scanned-PDF flow setting: ${name}`);
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
	process.env.REAL_SCANNED_PDF_REPORT_PATH ?? '/tmp/real-scanned-pdf-import-report.json';
const evidenceDir =
	process.env.REAL_SCANNED_PDF_EVIDENCE_DIR ?? '/tmp/real-scanned-pdf-import-evidence';
const runToken = `scan-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const ocrToken = `FICHARIOSCAN${Date.now()}`;
const filename = `real-scanned-${runToken}.pdf`;
const startedAt = new Date().toISOString();

const report = {
	schemaVersion: 1,
	target: target.origin,
	runToken,
	ocrToken,
	startedAt,
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], consoleErrors: [], serverErrors: [] },
	created: { documents: [], importSessions: [] },
	cleanup: { documents: 'pending', importSessions: 'pending' },
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

async function makeScannedPdf(context) {
	const capture = await context.newPage();
	let image;
	try {
		await capture.setViewportSize({ width: 1400, height: 1800 });
		await capture.setContent(`<!doctype html>
			<html><body style="margin:0;background:#fff;color:#111;font-family:Arial,sans-serif">
			<main style="padding:120px 100px">
				<h1 style="font-size:84px;line-height:1.08;margin:0 0 70px">${ocrToken}</h1>
				<p style="font-size:50px;line-height:1.45;margin:0 0 45px">Documento digitalizado para validar importação real de PDF, renderização local e OCR em segundo plano.</p>
				<p style="font-size:46px;line-height:1.45;margin:0">Marcador de verificação: ${ocrToken}</p>
			</main></body></html>`);
		image = await capture.screenshot({ type: 'png', fullPage: true });
	} finally {
		await capture.close();
	}

	const pdf = await PDFDocument.create();
	const embedded = await pdf.embedPng(image);
	const page = pdf.addPage([612, 792]);
	const margin = 24;
	const availableWidth = page.getWidth() - margin * 2;
	const availableHeight = page.getHeight() - margin * 2;
	const scale = Math.min(availableWidth / embedded.width, availableHeight / embedded.height);
	const width = embedded.width * scale;
	const height = embedded.height * scale;
	page.drawImage(embedded, {
		x: (page.getWidth() - width) / 2,
		y: (page.getHeight() - height) / 2,
		width,
		height
	});
	return Buffer.from(await pdf.save());
}

async function waitForRow(
	client,
	table,
	filters,
	{ timeoutMs = 120_000, intervalMs = 1_500 } = {}
) {
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
			.select('id,status,page_number,native_text,ocr_raw_text,corrected_text')
			.eq('document_id', documentId)
			.order('page_number');
		if (pagesError) throw new Error('Could not read scanned PDF pages');
		const pageIds = (pages ?? []).map((page) => page.id);
		if (pageIds.length > 0) {
			const { data: jobs, error: jobsError } = await client
				.from('ocr_jobs')
				.select('id,status,last_error_code,last_error_message,attempt_count,page_id')
				.in('page_id', pageIds);
			if (jobsError) throw new Error('Could not read scanned PDF OCR jobs');
			const failed = (jobs ?? []).find((job) => job.status === 'failed');
			if (failed) {
				throw new Error(
					`OCR job failed: ${failed.last_error_code ?? 'unknown'} ${failed.last_error_message ?? ''}`
				);
			}
			if (
				(jobs ?? []).length > 0 &&
				jobs.every((job) => ['ready', 'needs_review'].includes(job.status))
			) {
				const effective = (pages ?? [])
					.map((page) => page.corrected_text || page.ocr_raw_text || page.native_text || '')
					.join('\n');
				if (!effective.trim()) throw new Error('OCR finished without searchable text');
				return { pages, jobs, effective };
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 4_000));
	}
	throw new Error('Scanned PDF OCR did not finish within five minutes');
}

async function waitForSemanticIndex(client, pageIds, timeoutMs = 180_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data, error } = await client
			.from('page_semantic_chunks')
			.select('page_id,model,chunk_index,chunk_text')
			.in('page_id', pageIds)
			.limit(24);
		if (error) throw new Error('Could not read semantic index state');
		if ((data ?? []).length > 0) return data;
		await new Promise((resolve) => setTimeout(resolve, 4_000));
	}
	throw new Error('Automatic semantic indexing did not materialize within three minutes');
}

async function waitForQueueEntry(
	page,
	expectedFilename,
	{ timeoutMs = 240_000, final = false } = {}
) {
	const trigger = page.locator('button[aria-controls="global-import-queue"]');
	await trigger.waitFor({ state: 'visible', timeout: 20_000 });
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	const row = page.locator('#global-import-queue li').filter({ hasText: expectedFilename }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	const deadline = Date.now() + timeoutMs;
	let last = '';
	while (Date.now() < deadline) {
		last = (await row.innerText()).trim();
		if (/Cannot perform %TypedArray%|detached or out-of-bounds ArrayBuffer/i.test(last)) {
			throw new Error(`Detached ArrayBuffer regression reproduced: ${last}`);
		}
		if (/Falhou/i.test(last)) throw new Error(`Scanned PDF import failed: ${last}`);
		if (/Concluído|Pronto para revisão|Já existe/i.test(last)) return last;
		if (!final && /Leitura em segundo plano/i.test(last)) return last;
		await page.waitForTimeout(1_500);
	}
	throw new Error(`Timed out waiting for scanned PDF import; last state: ${last}`);
}

async function searchFor(page, text, expectedDocumentText) {
	await page.goto(new URL(`/search/?q=${encodeURIComponent(text)}`, target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	const input = page.locator('input[type="search"]');
	await input.waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
	const results = page.locator('section.results');
	await results.waitFor({ state: 'visible', timeout: 45_000 });
	if (!(await results.innerText()).includes(expectedDocumentText)) {
		throw new Error('Search did not return the scanned PDF after OCR');
	}
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
		// Document cleanup is still deterministic when a request payload cannot be inspected.
	}
}

async function cleanupDocuments(client) {
	const { data, error } = await client
		.from('documents')
		.select('id')
		.eq('original_filename', filename);
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

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const importResumeKeys = new Set();
let browser = null;
let context = null;

try {
	stage('backend-auth', 'running');
	const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
		email,
		password
	});
	if (signInError || !signIn.session) throw new Error('Staging credentials could not authenticate');
	stage('backend-auth', 'pass');

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
	page.on('request', (request) => captureImportResumeKey(request, importResumeKeys));
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') report.browser.consoleErrors.push(message.text().slice(0, 800));
	});
	page.on('response', trackServerResponse);

	stage('real-login', 'running');
	await page.goto(new URL('/login/', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(password);
	await page.getByRole('button', { name: 'Entrar', exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
	stage('real-login', 'pass');

	stage('scanned-pdf-build', 'running');
	const pdfBuffer = await makeScannedPdf(context);
	if (pdfBuffer.byteLength < 1) throw new Error('Synthetic scanned PDF was empty');
	stage('scanned-pdf-build', 'pass', `${pdfBuffer.byteLength} bytes`);

	stage('scanned-pdf-import', 'running');
	await page.goto(new URL('/import/', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	const pdfInput = page.locator('input[type="file"][accept*="application/pdf"]').first();
	await pdfInput.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: pdfBuffer });
	await page
		.getByText(/arquivo\(s\) adicionados à fila global/i)
		.waitFor({ state: 'visible', timeout: 20_000 });
	const initialQueue = await waitForQueueEntry(page, filename, { timeoutMs: 240_000 });
	const documentRow = await waitForRow(client, 'documents', { original_filename: filename });
	report.created.documents.push(documentRow.id);
	stage('scanned-pdf-import', 'pass', initialQueue.replace(/\s+/g, ' ').slice(0, 240));

	stage('scanned-pdf-ocr', 'running');
	const ocr = await waitForOcr(client, documentRow.id, 300_000);
	const finalQueue = await waitForQueueEntry(page, filename, { timeoutMs: 60_000, final: true });
	stage(
		'scanned-pdf-ocr',
		'pass',
		`${ocr.jobs.map((job) => job.status).join(',')} · ${finalQueue.replace(/\s+/g, ' ').slice(0, 180)}`
	);

	stage('automatic-semantic-index', 'running');
	const semanticChunks = await waitForSemanticIndex(
		client,
		ocr.pages.map((entry) => entry.id),
		180_000
	);
	stage(
		'automatic-semantic-index',
		'pass',
		`${semanticChunks.length} chunk(s) · ${[...new Set(semanticChunks.map((entry) => entry.model))].join(', ')}`
	);

	stage('scanned-pdf-search', 'running');
	await searchFor(page, ocrToken, documentRow.title);
	stage('scanned-pdf-search', 'pass');

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
		await context
			.pages()[0]
			?.screenshot({ path: `${evidenceDir}/failure.png`, fullPage: true })
			.catch(() => undefined);
	}
	process.exitCode = 1;
} finally {
	try {
		await cleanupDocuments(client);
		report.cleanup.documents = 'pass';
	} catch (error) {
		report.cleanup.documents = `fail: ${safeError(error)}`;
		if (report.status === 'pass') {
			report.status = 'fail';
			report.error = 'Synthetic scanned PDF cleanup failed';
			process.exitCode = 1;
		}
	}
	try {
		await cleanupImportSessions(client, importResumeKeys);
		report.cleanup.importSessions = 'pass';
	} catch (error) {
		report.cleanup.importSessions = `fail: ${safeError(error)}`;
		if (report.status === 'pass') {
			report.status = 'fail';
			report.error = 'Synthetic scanned PDF import-session cleanup failed';
			process.exitCode = 1;
		}
	}
	await client.auth.signOut().catch(() => undefined);
	await context?.close().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	await persistReport();
	console.log(`Real scanned PDF import: ${report.status.toUpperCase()} (${target.origin})`);
}
