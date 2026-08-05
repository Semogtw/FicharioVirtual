import { expect, test, type BrowserContext, type Route } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const importId = 'import-e2e-shared';
const resumeKey = 'resume-e2e-shared-import';
const sessionId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-08-05T05:00:00.000Z';
const pngBase64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
		email: 'owner@example.test',
		app_metadata: {},
		user_metadata: {},
		created_at: '2026-08-02T00:00:00.000Z'
	}
};

type RequestCounters = {
	consents: number;
	metadataCreates: number;
	ocrRuns: number;
	storageUploads: number;
	unknown: string[];
};

function json(route: Route, body: unknown, status = 200) {
	return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockSupabase(context: BrowserContext, counters: RequestCounters) {
	let importSession = {
		id: sessionId,
		user_id: userId,
		status: 'draft',
		total_items: 1,
		prepared_items: 0,
		uploaded_items: 0,
		completed_items: 0,
		last_error_code: null as string | null,
		local_resume_key: resumeKey,
		created_at: timestamp,
		updated_at: timestamp,
		finished_at: null as string | null
	};

	await context.route('http://127.0.0.1:54321/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;

		if (path === '/rest/v1/app_users') return json(route, { is_active: true });
		if (path === '/rest/v1/notebooks') return json(route, []);
		if (path === '/rest/v1/rpc/list_notebooks') return json(route, []);
		if (path === '/rest/v1/documents') return json(route, null);

		if (path === '/rest/v1/import_sessions' && request.method() === 'GET') {
			return json(route, []);
		}
		if (path === '/rest/v1/import_sessions' && request.method() === 'POST') {
			const body = request.postDataJSON() as Record<string, unknown>;
			importSession = {
				...importSession,
				status: String(body.status ?? 'draft'),
				total_items: Number(body.total_items ?? 1),
				local_resume_key: String(body.local_resume_key ?? resumeKey)
			};
			return json(route, importSession);
		}
		if (path === '/rest/v1/import_sessions' && request.method() === 'PATCH') {
			const body = request.postDataJSON() as Record<string, unknown>;
			importSession = {
				...importSession,
				status: String(body.status ?? importSession.status),
				total_items: Number(body.total_items ?? importSession.total_items),
				prepared_items: Number(body.prepared_items ?? importSession.prepared_items),
				uploaded_items: Number(body.uploaded_items ?? importSession.uploaded_items),
				completed_items: Number(body.completed_items ?? importSession.completed_items),
				last_error_code:
					body.last_error_code === null || typeof body.last_error_code === 'string'
						? body.last_error_code
						: importSession.last_error_code,
				finished_at:
					body.finished_at === null || typeof body.finished_at === 'string'
						? body.finished_at
						: importSession.finished_at,
				updated_at: timestamp
			};
			return json(route, importSession);
		}

		if (path === '/rest/v1/rpc/recover_stale_ocr_jobs') return json(route, null);
		if (path === '/rest/v1/rpc/list_runnable_ocr_jobs') return json(route, []);
		if (path === '/rest/v1/rpc/record_ocr_consent') {
			counters.consents += 1;
			return json(route, true);
		}
		if (path === '/rest/v1/rpc/create_image_import') {
			counters.metadataCreates += 1;
			const body = request.postDataJSON() as Record<string, string>;
			return json(route, [
				{
					document_id: body.target_document_id,
					page_id: body.target_page_id,
					ocr_job_id: body.target_job_id
				}
			]);
		}

		if (path.startsWith('/storage/v1/object/documents/')) {
			counters.storageUploads += 1;
			return json(route, { Key: path.slice('/storage/v1/object/'.length) });
		}
		if (path === '/functions/v1/process-ocr') {
			counters.ocrRuns += 1;
			return json(route, { state: 'complete', needsReview: false, warningCount: 0 });
		}

		counters.unknown.push(`${request.method()} ${path}`);
		return json(route, { message: 'Unexpected mocked request' }, 500);
	});
}

async function seedStoredImport(context: BrowserContext) {
	const seedPage = await context.newPage();
	await seedPage.goto('/favicon.svg');
	await seedPage.evaluate(
		async ({ encoded, id, ownerId, key, updatedAt }) => {
			const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
			const file = new File([bytes], 'shared.png', { type: 'image/png', lastModified: 0 });
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('fichario-resume', 2);
				request.onupgradeneeded = () => {
					const value = request.result;
					for (const storeName of ['image-imports', 'pdf-imports']) {
						if (value.objectStoreNames.contains(storeName)) continue;
						const store = value.createObjectStore(storeName, { keyPath: 'id' });
						store.createIndex('userId', 'userId', { unique: false });
						store.createIndex('updatedAt', 'updatedAt', { unique: false });
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction('image-imports', 'readwrite');
				transaction.objectStore('image-imports').put({
					version: 1,
					id,
					userId: ownerId,
					sessionId: null,
					resumeKey: key,
					file,
					mode: 'standard',
					notebookId: null,
					status: 'queued',
					preparedBytes: null,
					result: null,
					error: null,
					updatedAt
				});
				transaction.oncomplete = () => resolve();
				transaction.onerror = () =>
					reject(transaction.error ?? new Error('IndexedDB write failed'));
				transaction.onabort = () =>
					reject(transaction.error ?? new Error('IndexedDB write aborted'));
			});
			database.close();
		},
		{ encoded: pngBase64, id: importId, ownerId: userId, key: resumeKey, updatedAt: timestamp }
	);
	await seedPage.close();
}

test.use({ serviceWorkers: 'block' });

test('two tabs resume one persisted image import without duplicate upload or OCR', async ({
	context
}) => {
	const counters: RequestCounters = {
		consents: 0,
		metadataCreates: 0,
		ocrRuns: 0,
		storageUploads: 0,
		unknown: []
	};
	await context.addInitScript(
		({ storageKey, value }) => localStorage.setItem(storageKey, JSON.stringify(value)),
		{ storageKey: 'sb-127-auth-token', value: session }
	);
	await mockSupabase(context, counters);
	await seedStoredImport(context);

	const first = await context.newPage();
	const second = await context.newPage();
	await Promise.all([first.goto('/import/'), second.goto('/import/')]);

	await expect.poll(() => counters.ocrRuns, { timeout: 20_000 }).toBe(1);
	await expect
		.poll(async () => {
			return (
				(await first.getByText('Importação concluída', { exact: true }).count()) +
				(await second.getByText('Importação concluída', { exact: true }).count())
			);
		})
		.toBe(1);

	expect(counters.consents).toBe(1);
	expect(counters.metadataCreates).toBe(1);
	expect(counters.storageUploads).toBe(2);
	expect(counters.unknown).toEqual([]);

	await expect
		.poll(async () => {
			return first.evaluate(async (id) => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('fichario-resume', 2);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
				});
				const record = await new Promise<unknown>((resolve, reject) => {
					const request = database
						.transaction('image-imports', 'readonly')
						.objectStore('image-imports')
						.get(id);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
				});
				database.close();
				return record === undefined;
			}, importId);
		})
		.toBe(true);
});
