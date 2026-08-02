import { expect, test } from '@playwright/test';

test('login screen presents the private archive access form', async ({ page }) => {
	await page.goto('/login/');

	await expect(page.getByRole('heading', { name: 'Acesse seu fichário' })).toBeVisible();
	await expect(page.getByLabel('E-mail')).toBeVisible();
	await expect(page.getByLabel('Senha')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
	await expect(page.getByText('cadastro público desativado')).toBeVisible();
});
