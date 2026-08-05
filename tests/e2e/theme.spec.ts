import { expect, test } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const storageKey = 'fichario-theme';

test.beforeEach(async ({ page }) => {
	await page.addInitScript(
		({ authKey, session }) => {
			window.localStorage.setItem(authKey, JSON.stringify(session));
		},
		{
			authKey: 'sb-127-auth-token',
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

test('selects and restores the Rosa Pastel editorial theme', async ({ page }) => {
	await page.goto('/settings/');

	const roseOption = page.getByRole('radio', { name: /Rosa Pastel/ });
	await expect(roseOption).toBeVisible();
	await roseOption.click();

	await expect(page.locator('html')).toHaveAttribute('data-theme', 'rose');
	await expect(roseOption).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#fbf5f7');
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
		.toBe('rose');

	await page.reload();

	await expect(page.locator('html')).toHaveAttribute('data-theme', 'rose');
	await expect(page.getByRole('radio', { name: /Rosa Pastel/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(page.getByText('Rosa Pastel', { exact: true }).first()).toBeVisible();
});
