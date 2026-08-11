#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const REQUEST_TIMEOUT_MS = 20_000;
const baseUrl = new URL(process.argv[2] ?? process.env.DEPLOYMENT_URL ?? '');
if (baseUrl.protocol !== 'https:' || (baseUrl.pathname !== '/' && baseUrl.pathname !== '')) {
	throw new Error('Deployed UI check requires a clean HTTPS origin');
}

const evidenceDir = resolve(process.env.DEPLOYMENT_UI_EVIDENCE_DIR ?? 'deployment-ui-evidence');
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	locale: 'pt-BR',
	viewport: { width: 1440, height: 1000 }
});
const page = await context.newPage();
const pageErrors = [];
const policyErrors = [];
const failedCriticalRequests = [];

page.on('pageerror', (error) => {
	pageErrors.push(error.message);
});
page.on('console', (message) => {
	if (message.type() !== 'error') return;
	const text = message.text();
	if (
		/content security policy|refused to execute inline|refused to load|failed to load module script/i.test(
			text
		)
	) {
		policyErrors.push(text);
	}
});
page.on('requestfailed', (request) => {
	const type = request.resourceType();
	if (!['document', 'script', 'stylesheet'].includes(type)) return;
	const url = new URL(request.url());
	if (url.origin !== baseUrl.origin) return;
	failedCriticalRequests.push(
		`${type} ${url.pathname}: ${request.failure()?.errorText ?? 'failed'}`
	);
});

try {
	await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
	const homeHeading = page.locator('h1#page-title');
	await homeHeading.waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
	const homeText = (await homeHeading.textContent())?.trim();
	if (homeText !== 'Encontre a página certa.') {
		throw new Error(`Unexpected home heading: ${homeText ?? '(missing)'}`);
	}
	if ((await page.title()) !== 'Início — Fichário Virtual') {
		throw new Error(`Unexpected home title: ${await page.title()}`);
	}
	const bodyText = (await page.locator('body').innerText()).trim();
	if (bodyText.length < 40) throw new Error('Rendered home page is effectively blank');
	await page.screenshot({ path: `${evidenceDir}/home.png`, fullPage: true });

	const libraryLink = page.locator('a[href="/library/"]').filter({ hasText: 'Biblioteca' }).first();
	await libraryLink.click({ timeout: REQUEST_TIMEOUT_MS });
	await page.waitForURL((url) => url.pathname === '/library/', { timeout: REQUEST_TIMEOUT_MS });
	const libraryHeading = page.locator('h1#page-title');
	await libraryHeading.waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
	if ((await libraryHeading.textContent())?.trim() !== 'Biblioteca') {
		throw new Error('Library route did not render its expected heading');
	}
	await page.screenshot({ path: `${evidenceDir}/library.png`, fullPage: true });

	if (pageErrors.length > 0) {
		throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
	}
	if (policyErrors.length > 0) {
		throw new Error(`Browser CSP/resource errors: ${policyErrors.join(' | ')}`);
	}
	if (failedCriticalRequests.length > 0) {
		throw new Error(`Critical same-origin requests failed: ${failedCriticalRequests.join(' | ')}`);
	}

	console.log(`Deployed browser UI: PASS (${baseUrl.origin} -> /library/)`);
	console.log(`Screenshots: ${evidenceDir}/home.png, ${evidenceDir}/library.png`);
} finally {
	await context.close();
	await browser.close();
}
