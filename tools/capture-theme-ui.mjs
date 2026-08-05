import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
const outputDir = '/mnt/data';
const userId = '11111111-1111-4111-8111-111111111111';
const session = {
	access_token: 'e2e-access-token',
	refresh_token: 'e2e-refresh-token',
	token_type: 'bearer',
	expires_in: 3600,
	expires_at: 4_102_444_800,
	user: {
		id: userId,
		aud: 'authenticated',
		role: 'authenticated',
		email: 'arthur@example.test',
		app_metadata: {},
		user_metadata: {},
		created_at: '2026-08-02T00:00:00.000Z'
	}
};

const documents = [
	{
		id: '10000000-0000-4000-8000-000000000001',
		title: 'Anotações de Inteligência Artificial',
		kind: 'pdf',
		status: 'ready',
		page_count: 38,
		thumbnail_path: null,
		notebook_id: null,
		created_at: '2026-08-05T01:30:00.000Z',
		updated_at: '2026-08-05T01:30:00.000Z'
	},
	{
		id: '10000000-0000-4000-8000-000000000002',
		title: 'Arquitetura do Fichário Digital',
		kind: 'pdf',
		status: 'needs_review',
		page_count: 16,
		thumbnail_path: null,
		notebook_id: null,
		created_at: '2026-08-04T18:15:00.000Z',
		updated_at: '2026-08-04T18:15:00.000Z'
	},
	{
		id: '10000000-0000-4000-8000-000000000003',
		title: 'Resumo — Sistemas Operacionais',
		kind: 'image',
		status: 'ready',
		page_count: 7,
		thumbnail_path: null,
		notebook_id: null,
		created_at: '2026-08-03T14:20:00.000Z',
		updated_at: '2026-08-03T14:20:00.000Z'
	},
	{
		id: '10000000-0000-4000-8000-000000000004',
		title: 'Ideias e referências de projetos',
		kind: 'image',
		status: 'partially_ready',
		page_count: 12,
		thumbnail_path: null,
		notebook_id: null,
		created_at: '2026-08-01T10:00:00.000Z',
		updated_at: '2026-08-01T10:00:00.000Z'
	}
];

const usage = {
	generatedAt: '2026-08-05T08:00:00.000Z',
	today: { date: '2026-08-05', ocrPages: 8, quotaErrors: 0 },
	totals: {
		notebooks: 5,
		documents: 24,
		pages: 386,
		pendingPages: 3,
		reviewPages: 11,
		failedPages: 0,
		manualReviews: 19
	},
	daily: [{ date: '2026-08-05', ocrPages: 8, quotaErrors: 0 }]
};

async function waitForServer(timeoutMs = 30_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(baseURL);
			if (response.ok) return;
		} catch {
			// Retry until Vite is listening.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error('Preview server did not become ready');
}

async function preparePage(page) {
	await page.addInitScript(
		({ authKey, authValue, themeKey }) => {
			localStorage.setItem(authKey, JSON.stringify(authValue));
			localStorage.setItem(themeKey, 'rose');
		},
		{ authKey: 'sb-127-auth-token', authValue: session, themeKey: 'fichario-theme' }
	);

	await page.route('http://127.0.0.1:54321/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;

		if (path === '/rest/v1/app_users') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'Content-Range': '0-0/1' },
				body: JSON.stringify({ is_active: true })
			});
		}

		if (path === '/rest/v1/rpc/get_usage_overview') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(usage)
			});
		}

		if (path === '/rest/v1/documents' && request.method() === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'Content-Range': `0-${documents.length - 1}/${documents.length}` },
				body: JSON.stringify(documents)
			});
		}

		return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
	});
}

async function capture(context, path, heading, fileName) {
	const page = await context.newPage();
	await preparePage(page);
	await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
	await page.getByRole('heading', { name: heading }).waitFor();
	await page.waitForFunction(() => document.documentElement.dataset.theme === 'rose');
	await page.screenshot({ path: `${outputDir}/${fileName}`, fullPage: false });
	await page.close();
}

const server = spawn(
	process.execPath,
	['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173'],
	{
		cwd: process.cwd(),
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: process.platform !== 'win32'
	}
);

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

let browser;
try {
	await waitForServer();
	browser = await chromium.launch({ headless: true });

	const desktop = await browser.newContext({
		viewport: { width: 1440, height: 960 },
		deviceScaleFactor: 1
	});
	await capture(
		desktop,
		'/settings/',
		'Configurações',
		'fichario-rosa-pastel-settings-desktop.png'
	);
	await capture(desktop, '/', 'Encontre a página certa.', 'fichario-rosa-pastel-home-desktop.png');
	await desktop.close();

	const mobile = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 1,
		isMobile: true,
		hasTouch: true
	});
	await capture(mobile, '/settings/', 'Configurações', 'fichario-rosa-pastel-settings-mobile.png');
	await capture(mobile, '/', 'Encontre a página certa.', 'fichario-rosa-pastel-home-mobile.png');
	await mobile.close();

	console.log('Rosa Pastel Playwright screenshots created successfully.');
} finally {
	if (browser) await browser.close();
	try {
		if (process.platform === 'win32') server.kill('SIGTERM');
		else process.kill(-server.pid, 'SIGTERM');
	} catch {
		// The preview process may already have exited.
	}
	await new Promise((resolve) => setTimeout(resolve, 300));
	try {
		if (server.exitCode === null) {
			if (process.platform === 'win32') server.kill('SIGKILL');
			else process.kill(-server.pid, 'SIGKILL');
		}
	} catch {
		// Nothing left to stop.
	}
}
