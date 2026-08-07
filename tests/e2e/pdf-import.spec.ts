import { expect, test } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';

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
});

test('offers a separate PDF import flow with selective OCR disclosure', async ({ page }) => {
	await page.goto('/import/pdf/');

	await expect(page.getByRole('heading', { name: 'Importar PDFs' })).toBeVisible();
	await expect(
		page.getByRole('checkbox', { name: /Permitir OCR quando uma página não possuir texto/ })
	).toBeVisible();
	await expect(page.locator('input[type="file"][accept="application/pdf"]')).toBeAttached();
	await expect(page.getByRole('link', { name: 'Imagens' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'PDFs' })).toBeVisible();
});
