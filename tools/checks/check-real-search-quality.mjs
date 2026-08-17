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
	if (!process.env[name]) throw new Error(`Missing real-search-quality setting: ${name}`);
}

const target = new URL(process.env.TARGET_URL);
const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.STAGING_AUTHORIZED_EMAIL;
const password = process.env.STAGING_AUTHORIZED_PASSWORD;
const reportPath = process.env.SEARCH_QUALITY_REPORT_PATH ?? '/tmp/search-quality-report.json';
const evidenceDir = process.env.SEARCH_QUALITY_EVIDENCE_DIR ?? '/tmp/search-quality-evidence';
const runToken = `sq${Date.now()}${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
const exactToken = `MARCADOR${runToken.toUpperCase()}`;
const filename = `search-quality-${runToken}.pdf`;
const semanticSource =
	'A arborização urbana ameniza ilhas térmicas graças ao sombreamento e à evapotranspiração.';
const semanticQuery = 'por que municípios cheios de árvores costumam ter temperaturas menores';

const report = {
	schemaVersion: 1,
	target: target.origin,
	runToken,
	exactToken,
	semanticQuery,
	startedAt: new Date().toISOString(),
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], consoleErrors: [], serverErrors: [] },
	created: { documents: [] },
	observed: { highlightMarks: 0, semanticBadge: null, semanticChunks: 0 },
	cleanup: { documents: 'pending' },
	error: null
};

function stage(name, status, detail = null) {
	report.stages.push({ name, status, detail, at: new Date().toISOString() });
}

function safeError(error) {
	return error instanceof Error
		? `${error.name}: ${error.message}`.slice(0, 900)
		: String(error).slice(0, 900);
}

async function persistReport() {
	report.finishedAt = new Date().toISOString();
	await mkdir(evidenceDir, { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
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
	} else if (status >= 200 && status < 300) {
		report.browser.serverErrors = report.browser.serverErrors.filter(
			(value) => !value.endsWith(endpoint)
		);
	}
}

async function makePdf() {
	const pdf = await PDFDocument.create();
	pdf.setTitle(`Search quality ${runToken}`);
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const page = pdf.addPage([612, 792]);
	page.drawText(exactToken, { x: 48, y: 690, size: 22, font, color: rgb(0, 0, 0) });
	page.drawText('Marcador literal para validar busca e destaque no original.', {
		x: 48,
		y: 650,
		size: 14,
		font,
		color: rgb(0, 0, 0)
	});
	page.drawText(semanticSource, {
		x: 48,
		y: 600,
		size: 12,
		font,
		color: rgb(0, 0, 0),
		maxWidth: 515,
		lineHeight: 18
	});
	return Buffer.from(await pdf.save());
}

async function waitForRow(client, table, filters, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let query = client.from(table).select('*');
		for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
		const { data, error } = await query.limit(1).maybeSingle();
		if (error) throw new Error(`Could not read ${table}`);
		if (data) return data;
		await new Promise((resolve) => setTimeout(resolve, 1_500));
	}
	throw new Error(`Timed out waiting for ${table}`);
}

async function waitForUsableDocument(client, documentId, timeoutMs = 180_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data, error } = await client
			.from('documents')
			.select('id,status')
			.eq('id', documentId)
			.maybeSingle();
		if (error || !data) throw new Error('Could not inspect imported document');
		if (data.status === 'failed') throw new Error('Imported document reached failed status');
		if (['ready', 'partially_ready', 'needs_review'].includes(data.status)) return data;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error('Imported document did not become searchable');
}

async function waitForSemanticIndex(client, documentId, timeoutMs = 240_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { data: pages, error: pagesError } = await client
			.from('pages')
			.select('id')
			.eq('document_id', documentId);
		if (pagesError) throw new Error('Could not inspect document pages for semantic index');
		const pageIds = (pages ?? []).map((page) => page.id);
		if (pageIds.length > 0) {
			const { data, error } = await client
				.from('page_semantic_chunks')
				.select('page_id,model,chunk_index,chunk_text')
				.in('page_id', pageIds)
				.limit(24);
			if (error) throw new Error('Could not read semantic index state');
			if ((data ?? []).length > 0) return data;
		}
		await new Promise((resolve) => setTimeout(resolve, 4_000));
	}
	throw new Error('Automatic semantic index did not materialize');
}

async function waitForQueue(page, timeoutMs = 180_000) {
	const trigger = page.locator('button[aria-controls="global-import-queue"]');
	await trigger.waitFor({ state: 'visible', timeout: 20_000 });
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	const row = page.locator('#global-import-queue li').filter({ hasText: filename }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
	const deadline = Date.now() + timeoutMs;
	let last = '';
	while (Date.now() < deadline) {
		last = (await row.innerText()).replace(/\s+/g, ' ').trim();
		if (/Falhou|erro/i.test(last)) throw new Error(`Import queue failed: ${last}`);
		if (/Concluído|Pronto para revisão|Leitura em segundo plano|Já existe/i.test(last)) return last;
		await page.waitForTimeout(1_500);
	}
	throw new Error(`Import queue timed out: ${last}`);
}

async function searchResult(page, query, documentId) {
	await page.goto(new URL(`/search/?q=${encodeURIComponent(query)}`, target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page.locator('input[type="search"]').waitFor({ state: 'visible', timeout: 20_000 });
	await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
	const results = page.locator('section.results');
	await results.waitFor({ state: 'visible', timeout: 60_000 });
	const links = results.locator(`a[href^="/documents/${documentId}/"]`);
	await links.first().waitFor({ state: 'visible', timeout: 60_000 });
	if ((await links.count()) !== 1) throw new Error(`Expected exactly one card for ${documentId}`);
	const link = links.first();
	await link.scrollIntoViewIfNeeded();
	await link.locator('img').first().waitFor({ state: 'visible', timeout: 45_000 });
	return link;
}

async function assertNoVisibleFailure(page, context) {
	for (const alert of await page.locator('[role="alert"]:visible').all()) {
		const text = (await alert.innerText()).trim();
		if (/não foi possível|falhou|erro|indisponível/i.test(text)) {
			throw new Error(`${context} exposed failure: ${text}`);
		}
	}
}

const client = createClient(supabaseUrl, publishableKey, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
let browser = null;
let context = null;

try {
	stage('backend-auth', 'running');
	const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
		email,
		password
	});
	if (signInError || !signIn.session)
		throw new Error('Protected staging credentials could not authenticate');
	const allowed = await client.rpc('is_authorized_user');
	if (allowed.error || allowed.data !== true)
		throw new Error('Protected staging account is not authorized');
	stage('backend-auth', 'pass');

	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
	const page = await context.newPage();
	page.on('pageerror', (error) => report.browser.pageErrors.push(safeError(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') report.browser.consoleErrors.push(message.text().slice(0, 900));
	});
	page.on('response', trackServerResponse);

	stage('browser-login', 'running');
	await page.goto(new URL('/login/', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(password);
	await page.getByRole('button', { name: 'Entrar', exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
	stage('browser-login', 'pass');

	stage('real-pdf-import', 'running');
	await page.goto(new URL('/import/', target).href, {
		waitUntil: 'domcontentloaded',
		timeout: 45_000
	});
	await page
		.locator('input[type="file"][accept*="application/pdf"]')
		.first()
		.setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: await makePdf() });
	await page
		.getByText(/arquivo\(s\) adicionados\./i)
		.waitFor({ state: 'visible', timeout: 20_000 });
	const queueState = await waitForQueue(page);
	const document = await waitForRow(client, 'documents', { original_filename: filename });
	report.created.documents.push(document.id);
	await waitForUsableDocument(client, document.id);
	stage('real-pdf-import', 'pass', queueState.slice(0, 240));

	stage('semantic-index', 'running');
	const chunks = await waitForSemanticIndex(client, document.id);
	report.observed.semanticChunks = chunks.length;
	stage(
		'semantic-index',
		'pass',
		`${chunks.length} chunk(s) · ${chunks[0]?.model ?? 'unknown model'}`
	);

	stage('exact-search', 'running');
	const exactResult = await searchResult(page, exactToken, document.id);
	const exactCards = page.locator('section.results ol > li');
	const exactCardCount = await exactCards.count();
	if (exactCardCount !== 1) {
		throw new Error(`Exact opaque marker returned ${exactCardCount} document cards instead of 1`);
	}
	await page.screenshot({ path: `${evidenceDir}/01-exact-search.png`, fullPage: true });
	await assertNoVisibleFailure(page, 'exact search');
	stage('exact-search', 'pass', '1 precise document card');

	stage('original-highlight', 'running');
	await exactResult.click();
	await page.waitForURL((url) => url.pathname.includes(`/documents/${document.id}/`), {
		timeout: 30_000
	});
	await page
		.getByText(/Aberto a partir da busca por/i)
		.waitFor({ state: 'visible', timeout: 30_000 });
	const marks = page.locator('.geometry-layer mark');
	await marks.first().waitFor({ state: 'visible', timeout: 60_000 });
	report.observed.highlightMarks = await marks.count();
	if (report.observed.highlightMarks < 1)
		throw new Error('Search opened the original without a visible geometric mark');
	await page.screenshot({ path: `${evidenceDir}/02-original-highlight.png`, fullPage: true });
	await assertNoVisibleFailure(page, 'original highlight');
	stage('original-highlight', 'pass', `${report.observed.highlightMarks} visible mark(s)`);

	stage('semantic-paraphrase-search', 'running');
	const semanticResult = await searchResult(page, semanticQuery, document.id);
	const badges = (await semanticResult.locator('.badges').innerText()).replace(/\s+/g, ' ').trim();
	report.observed.semanticBadge = badges;
	if (!/(Por sentido|Sentido \+ página)/i.test(badges)) {
		throw new Error(`Paraphrase result was not semantic-only enough: ${badges}`);
	}
	await page.screenshot({ path: `${evidenceDir}/03-semantic-paraphrase.png`, fullPage: true });
	await assertNoVisibleFailure(page, 'semantic paraphrase search');
	stage('semantic-paraphrase-search', 'pass', badges);

	if (report.browser.pageErrors.length > 0) {
		throw new Error(`Browser page errors: ${report.browser.pageErrors.join(' | ')}`);
	}
	if (report.browser.serverErrors.length > 0) {
		throw new Error(`Server 5xx responses: ${report.browser.serverErrors.join(' | ')}`);
	}
	report.status = 'pass';
} catch (error) {
	report.status = 'fail';
	report.error = safeError(error);
	stage('failure', 'fail', report.error);
	await context
		?.pages()[0]
		?.screenshot({ path: `${evidenceDir}/failure.png`, fullPage: true })
		.catch(() => undefined);
	process.exitCode = 1;
} finally {
	let cleanupError = null;
	const { data: cleanupRows, error: cleanupDiscoveryError } = await client
		.from('documents')
		.select('id')
		.eq('original_filename', filename);
	if (cleanupDiscoveryError) cleanupError = cleanupDiscoveryError;
	const ids = [
		...new Set([...(cleanupRows ?? []).map((row) => row.id), ...report.created.documents])
	];
	if (!cleanupError) {
		for (const documentId of ids) {
			const { error: deleteError } = await client.functions.invoke('delete-document', {
				body: { documentId }
			});
			if (deleteError) {
				cleanupError = deleteError;
				break;
			}
		}
	}
	if (cleanupError) {
		report.cleanup.documents = `fail: ${safeError(cleanupError)}`;
		if (report.status === 'pass') {
			report.status = 'fail';
			report.error = 'Synthetic search-quality cleanup failed';
			process.exitCode = 1;
		}
	} else {
		report.cleanup.documents = 'pass';
	}
	await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
	await context?.close().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	await persistReport();
	console.log(`Real search quality: ${report.status.toUpperCase()} (${target.origin})`);
}
