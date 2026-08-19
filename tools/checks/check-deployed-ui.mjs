#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const REQUEST_TIMEOUT_MS = 20_000;
const VISIBLE_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
const baseUrl = new URL(process.argv[2] ?? process.env.DEPLOYMENT_URL ?? '');
if (baseUrl.protocol !== 'https:' || (baseUrl.pathname !== '/' && baseUrl.pathname !== '')) {
	throw new Error('Deployed UI check requires a clean HTTPS origin');
}

const evidenceDir = resolve(process.env.DEPLOYMENT_UI_EVIDENCE_DIR ?? 'deployment-ui-evidence');
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function runAttempt(attempt) {
	const context = await browser.newContext({
		locale: 'pt-BR',
		viewport: { width: 1440, height: 1000 }
	});
	const page = await context.newPage();
	const pageErrors = [];
	const consoleErrors = [];
	const failedCriticalRequests = [];
	const criticalResponses = [];

	page.on('pageerror', (error) => {
		pageErrors.push(error.message);
	});
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
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
	page.on('response', (response) => {
		const request = response.request();
		const type = request.resourceType();
		if (!['document', 'script', 'stylesheet'].includes(type)) return;
		const url = new URL(response.url());
		if (url.origin !== baseUrl.origin) return;
		criticalResponses.push(
			`${response.status()} ${type} ${url.pathname} ${response.headers()['content-type'] ?? '(no content-type)'}`
		);
	});

	async function captureEvidence(label) {
		const suffix = attempt === 1 ? '' : `-attempt-${attempt}`;
		const screenshotPath = `${evidenceDir}/${label}${suffix}.png`;
		const statePath = `${evidenceDir}/${label}${suffix}.txt`;
		await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
		const bodyText = await page
			.locator('body')
			.innerText()
			.catch(() => '');
		const bodyHtml = await page
			.locator('body')
			.innerHTML()
			.catch(() => '');
		const state = [
			`attempt=${attempt}`,
			`url=${page.url()}`,
			`title=${await page.title().catch(() => '')}`,
			`body_text=${JSON.stringify(bodyText.slice(0, 4000))}`,
			`body_html=${JSON.stringify(bodyHtml.slice(0, 8000))}`,
			`page_errors=${JSON.stringify(pageErrors)}`,
			`console_errors=${JSON.stringify(consoleErrors)}`,
			`failed_critical_requests=${JSON.stringify(failedCriticalRequests)}`,
			`critical_responses=${JSON.stringify(criticalResponses)}`
		].join('\n');
		await writeFile(statePath, `${state}\n`, 'utf8');
		console.log(state);
	}

	async function assertLoginVisible(label, startedAt) {
		const heading = page.getByRole('heading', { name: 'Acesse seu fichário', exact: true });
		await heading.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
		const visibleMs = Math.round(performance.now() - startedAt);
		const currentUrl = new URL(page.url());
		if (currentUrl.pathname !== '/login/') {
			throw new Error(`Anonymous root must settle on /login/, got ${currentUrl.pathname}`);
		}
		if ((await page.title()) !== 'Entrar — Fichário Virtual') {
			throw new Error(`Unexpected login title: ${await page.title()}`);
		}
		for (const locator of [
			page.locator('input[type="email"]'),
			page.locator('input[type="password"]'),
			page.getByRole('button', { name: 'Entrar', exact: true })
		]) {
			await locator.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
		}
		const bodyText = (await page.locator('body').innerText()).trim();
		if (bodyText.length < 80) throw new Error('Rendered login page is effectively blank');
		await captureEvidence(label);
		console.log(`PASS ${label} visible in ${visibleMs}ms`);
		return visibleMs;
	}

	function assertNoBrowserErrors() {
		if (pageErrors.length > 0) {
			throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
		}
		if (consoleErrors.length > 0) {
			throw new Error(`Browser console errors: ${consoleErrors.join(' | ')}`);
		}
		if (failedCriticalRequests.length > 0) {
			throw new Error(
				`Critical same-origin requests failed: ${failedCriticalRequests.join(' | ')}`
			);
		}
	}

	try {
		const firstNavigationStarted = performance.now();
		await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
		const firstVisibleMs = await assertLoginVisible('login', firstNavigationStarted);

		await page.evaluate(async (timeoutMs) => {
			if (!('serviceWorker' in navigator)) throw new Error('Service Worker API is unavailable');
			await Promise.race([
				navigator.serviceWorker.ready,
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error('Service Worker did not become ready')), timeoutMs);
				})
			]);
		}, REQUEST_TIMEOUT_MS);

		const reloadStarted = performance.now();
		await page.reload({ waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
		const reloadVisibleMs = await assertLoginVisible('login-after-sw-reload', reloadStarted);
		const serviceWorkerControlsPage = await page.evaluate(() =>
			Boolean(navigator.serviceWorker.controller)
		);
		if (!serviceWorkerControlsPage) {
			throw new Error('Reloaded login page is not controlled by the active service worker');
		}

		assertNoBrowserErrors();
		console.log(
			`Deployed browser UI: PASS (${baseUrl.origin}, attempt=${attempt}, first=${firstVisibleMs}ms, service-worker reload=${reloadVisibleMs}ms)`
		);
	} catch (error) {
		await captureEvidence('failure');
		throw error;
	} finally {
		await context.close();
	}
}

try {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		try {
			await runAttempt(attempt);
			lastError = undefined;
			break;
		} catch (error) {
			lastError = error;
			if (attempt === MAX_ATTEMPTS) break;
			console.warn(
				`Deployed UI attempt ${attempt}/${MAX_ATTEMPTS} failed; retrying after Cloudflare alias convergence: ${error instanceof Error ? error.message : String(error)}`
			);
			await delay(attempt * 2_000);
		}
	}
	if (lastError) throw lastError;
} finally {
	await browser.close();
}
