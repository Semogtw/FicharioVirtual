import { expect, test } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';

test.beforeEach(async ({ page }) => {
	await page.addInitScript(
		({ storageKey, session }) => {
			window.localStorage.setItem(storageKey, JSON.stringify(session));
		},
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

	await page.route('http://127.0.0.1:54321/rest/v1/app_users**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ is_active: true })
		});
	});
});

test('shows persistent library navigation on the tablet viewport', async ({ page }) => {
	await page.goto('/');

	const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
	await expect(navigation).toBeVisible();
	await expect(navigation.getByRole('link', { name: 'Biblioteca', exact: true })).toBeVisible();
	await expect(navigation.getByRole('link', { name: 'Importar', exact: true })).toBeVisible();
	await expect(page.getByRole('search')).toBeVisible();
});
