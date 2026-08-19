import { expect, test } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';

const unifiedFileInput =
	'input[type="file"][accept="application/pdf,image/jpeg,image/png,image/webp"]';

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7l1EAAAAASUVORK5CYII=',
	'base64'
);

test.beforeEach(async ({ page }) => {
	await page.addInitScript(
		({ storageKey, session }) => localStorage.setItem(storageKey, JSON.stringify(session)),
		{
			storageKey: 'sb-127-auth-token',
			session: {
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
			}
		}
	);
	await page.route('http://127.0.0.1:54321/rest/v1/app_users**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{"is_active":true}' })
	);
	await page.route('http://127.0.0.1:54321/rest/v1/rpc/list_notebooks**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
});

test('uses the unified import surface for PDFs with automatic background OCR', async ({ page }) => {
	await page.goto('/import/pdf/');

	await expect(page.getByRole('heading', { name: 'Adicionar ao fichário' })).toBeVisible();
	await expect(page.getByText('Fotos e PDFs entram por aqui')).toBeVisible();
	await expect(
		page.getByRole('checkbox', { name: /Permitir OCR quando uma página não possuir texto/ })
	).toHaveCount(0);
	await expect(page.locator(unifiedFileInput)).toBeAttached();
	await expect(page.getByRole('button', { name: 'Escolher arquivos' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Imagens' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'PDFs' })).toHaveCount(0);
});

test('stages multiple photos as one ordered document by default', async ({ page }) => {
	await page.goto('/import/');

	await page.locator(unifiedFileInput).setInputFiles([
		{ name: 'redes-aula-1.png', mimeType: 'image/png', buffer: tinyPng },
		{ name: 'redes-aula-2.png', mimeType: 'image/png', buffer: tinyPng }
	]);

	await expect(page.getByRole('heading', { name: '2 páginas' })).toBeVisible();
	await expect(page.getByRole('radio', { name: /Um documento/ })).toBeChecked();
	await expect(page.getByRole('radio', { name: /Separadas/ })).not.toBeChecked();
	await expect(page.getByLabel('Título')).toHaveValue('redes-aula-1');
	await expect(page.getByAltText('Prévia da página 1')).toBeVisible();
	await expect(page.getByAltText('Prévia da página 2')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Salvar documento' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mover página 1 para antes' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Mover página 2 para depois' })).toBeDisabled();
});
