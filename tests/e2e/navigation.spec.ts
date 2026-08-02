import { expect, test } from '@playwright/test';

test('shows persistent library navigation on the tablet viewport', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Biblioteca' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Importar' })).toBeVisible();
	await expect(page.getByRole('search')).toBeVisible();
});
