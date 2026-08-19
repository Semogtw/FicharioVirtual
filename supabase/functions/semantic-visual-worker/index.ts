import { createClient } from 'npm:@supabase/supabase-js@2';
import { indexBackgroundVisualPass } from '../_shared/background-visual-indexer.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const WORKER_MODE_HEADER = 'X-Fichario-Worker-Mode';

type WorkerConfig = Readonly<{
	supabaseUrl: string;
	serviceRoleKey: string;
	workerKey: string;
	apiKey: string;
	batchPages: number;
	maxBatchBytes: number;
	timeoutMs: number;
}>;

function response(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function config(): WorkerConfig | null {
	if (Deno.env.get('SEMANTIC_VISUAL_INDEX_ENABLED') === 'false') return null;
	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const workerKey = Deno.env.get('OCR_BACKGROUND_WORKER_KEY');
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const batchPages = envInteger('SEMANTIC_VISUAL_BATCH_PAGES', 4, 1, 6);
	const maxBatchBytes = envInteger(
		'SEMANTIC_VISUAL_BATCH_BYTES',
		16 * 1024 * 1024,
		1024 * 1024,
		24 * 1024 * 1024
	);
	const timeoutMs = envInteger('SEMANTIC_VISUAL_TIMEOUT_MS', 90_000, 10_000, 120_000);
	if (
		!supabaseUrl ||
		!serviceRoleKey ||
		!workerKey ||
		!apiKey ||
		batchPages === null ||
		maxBatchBytes === null ||
		timeoutMs === null
	) {
		return null;
	}
	return Object.freeze({
		supabaseUrl,
		serviceRoleKey,
		workerKey,
		apiKey,
		batchPages,
		maxBatchBytes,
		timeoutMs
	});
}

async function sha256(value: string) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function secretMatches(presented: string | null, expected: string) {
	if (!presented || presented.length !== expected.length) return false;
	const [left, right] = await Promise.all([sha256(presented), sha256(expected)]);
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
	return difference === 0;
}

async function runPass(settings: WorkerConfig) {
	const admin = createClient(settings.supabaseUrl, settings.serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
	try {
		return await indexBackgroundVisualPass({
			admin,
			apiKey: settings.apiKey,
			batchPages: settings.batchPages,
			maxBatchBytes: settings.maxBatchBytes,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeout);
	}
}

async function runAndChain(settings: WorkerConfig) {
	try {
		const result = await runPass(settings);
		if (!result.hasMore) return;
		const chained = await fetch(`${settings.supabaseUrl}/functions/v1/semantic-visual-worker`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Fichario-Worker-Key': settings.workerKey
			},
			body: JSON.stringify({ source: 'chain' })
		});
		if (!chained.ok) console.error('semantic_visual_chain_failed', chained.status);
	} catch (error) {
		console.error(
			'semantic_visual_execution_failed',
			error instanceof Error ? error.name : 'unknown'
		);
	}
}

Deno.serve(async (request) => {
	if (request.method !== 'POST') return response(405, { code: 'method_not_allowed' });
	const settings = config();
	if (!settings) return response(503, { code: 'semantic_visual_not_configured' });
	if (!(await secretMatches(request.headers.get('X-Fichario-Worker-Key'), settings.workerKey))) {
		return response(401, { code: 'worker_authentication_required' });
	}

	const mode = request.headers.get(WORKER_MODE_HEADER);
	if (mode === 'sync') {
		try {
			return response(200, { completed: true, ...(await runPass(settings)) });
		} catch (error) {
			return response(500, {
				code:
					error instanceof DOMException && error.name === 'AbortError'
						? 'semantic_visual_timeout'
						: 'semantic_visual_execution_failed'
			});
		}
	}
	if (mode !== null) return response(400, { code: 'invalid_worker_mode' });

	EdgeRuntime.waitUntil(runAndChain(settings));
	return response(202, { accepted: true });
});
