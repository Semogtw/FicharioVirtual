import { expect, test, type Route } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-08-10T16:00:00.000Z';
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

function json(route: Route, body: unknown, status = 200) {
	return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test.use({ serviceWorkers: 'block' });

test('adds, repositions and removes a private notebook banner', async ({ page }) => {
	let bannerPath: string | null = null;
	let bannerPositionX = 50;
	let bannerPositionY = 50;
	let uploadedPath: string | null = null;
	const patchBodies: Record<string, unknown>[] = [];

	await page.addInitScript(
		({ storageKey, value }) => localStorage.setItem(storageKey, JSON.stringify(value)),
		{ storageKey: 'sb-127-auth-token', value: session }
	);

	await page.route('http://127.0.0.1:54321/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;

		if (path === '/rest/v1/app_users') return json(route, { is_active: true });
		if (path === '/rest/v1/rpc/list_notebooks') {
			return json(route, [
				{
					id: notebookId,
					name: 'Biologia',
					description: 'Genética e evolução',
					cover_style: 'linen',
					banner_path: bannerPath,
					banner_position_x: bannerPositionX,
					banner_position_y: bannerPositionY,
					created_at: timestamp,
					updated_at: timestamp,
					document_count: 0
				}
			]);
		}
		if (path === '/rest/v1/documents') return json(route, []);
		if (path === '/rest/v1/notebooks' && request.method() === 'GET') {
			return json(route, {
				banner_path: bannerPath,
				banner_position_x: bannerPositionX,
				banner_position_y: bannerPositionY
			});
		}
		if (path === '/rest/v1/notebooks' && request.method() === 'PATCH') {
			const body = request.postDataJSON() as Record<string, unknown>;
			patchBodies.push(body);
			bannerPath = typeof body.banner_path === 'string' ? body.banner_path : null;
			bannerPositionX = Number(body.banner_position_x ?? 50);
			bannerPositionY = Number(body.banner_position_y ?? 50);
			return route.fulfill({ status: 204, body: '' });
		}
		if (path.startsWith('/storage/v1/object/documents/') && request.method() === 'POST') {
			uploadedPath = decodeURIComponent(path.slice('/storage/v1/object/documents/'.length));
			return json(route, { Key: `documents/${uploadedPath}` });
		}
		if (path.startsWith('/storage/v1/object/documents/') && request.method() === 'DELETE') {
			return json(route, []);
		}
		if (path.startsWith('/storage/v1/object/sign/documents/') && request.method() === 'POST') {
			return json(route, {
				signedURL: `${path.replace('/storage/v1', '')}?token=e2e-banner`
			});
		}
		if (path.startsWith('/storage/v1/object/sign/documents/') && request.method() === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'image/png',
				body: Buffer.from(pngBase64, 'base64')
			});
		}

		return json(route, { message: `Unexpected mocked request: ${request.method()} ${path}` }, 500);
	});

	await page.goto('/notebooks/');
	await page.getByRole('link', { name: 'Abrir caderno Biologia' }).click();
	await expect(page.getByRole('heading', { name: 'Biologia' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Adicionar banner' })).toBeVisible();

	await page.getByRole('button', { name: 'Adicionar banner' }).click();
	await expect(page.getByRole('heading', { name: 'Personalizar banner' })).toBeVisible();
	await page.getByLabel('Imagem do banner').setInputFiles({
		name: 'caderno.png',
		mimeType: 'image/png',
		buffer: Buffer.from(pngBase64, 'base64')
	});
	await page.getByLabel(/Posição horizontal/).fill('38');
	await page.getByLabel(/Posição vertical/).fill('64');
	await page.getByRole('button', { name: 'Salvar banner' }).click();

	await expect(page.getByRole('button', { name: 'Personalizar banner' })).toBeVisible();
	await expect(page.locator('.banner img')).toBeVisible();
	await expect
		.poll(() => uploadedPath)
		.toMatch(new RegExp(`^${userId}/notebook-banners/${notebookId}/.+\\.webp$`));
	await expect.poll(() => patchBodies.at(-1)?.banner_position_x).toBe(38);
	await expect.poll(() => patchBodies.at(-1)?.banner_position_y).toBe(64);

	await page.getByRole('button', { name: 'Personalizar banner' }).click();
	await page.getByLabel(/Posição horizontal/).fill('20');
	await page.getByRole('button', { name: 'Salvar banner' }).click();
	await expect.poll(() => patchBodies.at(-1)?.banner_position_x).toBe(20);
	await expect(page.locator('.banner img')).toHaveCSS('object-position', '20% 64%');

	await page.getByRole('button', { name: 'Personalizar banner' }).click();
	await page.getByRole('button', { name: 'Remover banner' }).click();
	await expect(page.getByRole('button', { name: 'Adicionar banner' })).toBeVisible();
	await expect(page.locator('.banner')).toHaveCount(0);
});
