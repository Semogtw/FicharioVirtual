import { expect, test } from '@playwright/test';

test('login screen exposes both sign-in and public signup modes', async ({ page }) => {
	await page.goto('/login/');

	await expect(page.getByRole('heading', { name: 'Acesse seu fichário' })).toBeVisible();
	await expect(page.getByLabel('E-mail')).toBeVisible();
	await expect(page.getByLabel('Senha')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByRole('button', { name: 'Criar conta', exact: true })).toBeVisible();
	await expect(page.getByText('Ainda não tem uma conta?')).toBeVisible();

	await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Criar conta', exact: true }).first()).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByLabel('Senha')).toHaveAttribute('autocomplete', 'new-password');
	await expect(page.getByText('A conta pública usa o mesmo Fichário')).toBeVisible();
});
