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
const negativeQueries = [
	'como preparar uma receita de bolo de chocolate com cobertura',
	'como trocar o óleo do motor de um carro',
	'como plantar tomates em uma horta',
	'regras para saque no voleibol profissional',
	'como consertar o freio de uma motocicleta'
];

const report = {
	schemaVersion: 2,
	target: target.origin,
	runToken,
	exactToken,
	semanticQuery,
	negativeQueries,
	startedAt: new Date().toISOString(),
	finishedAt: null,
	status: 'running',
	stages: [],
	browser: { pageErrors: [], consoleErrors: [], serverErrors: [] },
	created: { documents: [] },
	observed: {
		highlightMarks: 0,
		semanticHighlightMarks: null,
		semanticBadge: null,
		semanticChunks: 0
	},
	quality: {
		exact: null,
		semantic: null,
		negative: {
			queryCount: negativeQueries.length,
			falsePositiveQueries: 0,
			falsePositiveRate: null,
			observations: []
		}
	},
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

function searchMetrics(results, documentId) {
	const index = results.findIndex((result) => result.documentId === documentId);
	const rank = index < 0 ? null : index + 1;
	return {
		rank,
		recallAt1: rank === 1 ? 1 : 0,
		recallAt3: rank !== null && rank <= 3 ? 1 : 0,
		mrr: rank === null ? 0 : 1 / rank,
		resultCount: results.length,
		matchMode: rank === null ? null : (results[index]?.matchMode ?? null),
		semanticSimilarity: rank === null ? null : (results[index]?.semanticSimilarity ?? null)
	};
}

async function backendSearch(query, limit = 30) {
	const { data, error } = await client.functions.invoke('semantic-search', {
		body: { query, notebookId: null, limit, offset: 0 }
	});
	if (error) throw new Error(`Semantic search function failed for ${JSON.stringify(query)}`);
	if (!data || !Array.isArray(data.results)) {
		throw new Error(`Semantic search returned an invalid result set for ${JSON.stringify(query)}`);
	}
	return data.results;
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

	stage('search-quality-metrics', 'running');
	const exactBackendResults = await backendSearch(exactToken);
	const semanticBackendResults = await backendSearch(semanticQuery);
	report.quality.exact = searchMetrics(exactBackendResults, document.id);
	report.quality.semantic = searchMetrics(semanticBackendResults, document.id);
	if (report.quality.exact.recallAt1 !== 1 || report.quality.exact.mrr !== 1) {
		throw new Error(`Exact retrieval quality regressed: ${JSON.stringify(report.quality.exact)}`);
	}
	// The shared staging account intentionally retains prior audit fixtures. A
	// pre-existing document with the exact natural-language wording can be a
	// legitimate first result, so the imported semantic fixture must be in the
	// top three rather than being forced to win an unstable tie at rank one.
	if (report.quality.semantic.recallAt3 !== 1) {
		throw new Error(
			`Semantic retrieval quality regressed: ${JSON.stringify(report.quality.semantic)}`
		);
	}
	for (const query of negativeQueries) {
		const results = await backendSearch(query);
		const falsePositive = results.length > 0;
		if (falsePositive) report.quality.negative.falsePositiveQueries += 1;
		report.quality.negative.observations.push({
			query,
			falsePositive,
			resultCount: results.length,
			resultDocumentIds: results.map((result) => result.documentId),
			matchModes: results.map((result) => result.matchMode),
			topSemanticSimilarity:
				results.length > 0
					? Math.max(...results.map((result) => Number(result.semanticSimilarity) || 0))
					: null
		});
	}
	report.quality.negative.falsePositiveRate =
		report.quality.negative.falsePositiveQueries / negativeQueries.length;
	if (report.quality.negative.falsePositiveRate !== 0) {
		throw new Error(
			`Negative semantic false-positive rate is ${report.quality.negative.falsePositiveRate}`
		);
	}
	stage(
		'search-quality-metrics',
		'pass',
		`Recall@3=${report.quality.semantic.recallAt3} · MRR=${report.quality.semantic.mrr.toFixed(3)} · negative FPR=0`
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
	const semanticHref = await semanticResult.getAttribute('href');
	if (!semanticHref || new URL(semanticHref, target).searchParams.has('highlight')) {
		throw new Error(`Semantic-only result still carried a lexical highlight: ${semanticHref}`);
	}
	await page.screenshot({ path: `${evidenceDir}/03-semantic-paraphrase.png`, fullPage: true });
	await semanticResult.click();
	await page.waitForURL((url) => url.pathname.includes(`/documents/${document.id}/`), {
		timeout: 30_000
	});
	if (new URL(page.url()).searchParams.has('highlight')) {
		throw new Error('Semantic-only navigation injected a lexical highlight parameter');
	}
	await page.locator('.media-viewer').first().waitFor({ state: 'visible', timeout: 45_000 });
	await page.waitForTimeout(1_000);
	report.observed.semanticHighlightMarks = await page.locator('.geometry-layer mark').count();
	if (report.observed.semanticHighlightMarks !== 0) {
		throw new Error(
			`Semantic-only result rendered ${report.observed.semanticHighlightMarks} misleading mark(s)`
		);
	}
	await page.screenshot({ path: `${evidenceDir}/04-semantic-open.png`, fullPage: true });
	await assertNoVisibleFailure(page, 'semantic paraphrase search');
	stage(
		'semantic-paraphrase-search',
		'pass',
		`${badges} · no lexical highlight in card or original`
	);

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
