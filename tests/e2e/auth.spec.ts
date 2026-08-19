import { expect, test } from '@playwright/test';

test('login screen exposes both sign-in and public signup modes', async ({ page }) => {
	await page.goto('/login/');

	await expect(page.getByRole('heading', { name: 'Acesse seu fichário' })).toBeVisible();
	await expect(page.getByLabel('E-mail')).toBeVisible();
	await expect(page.getByLabel('Senha')).toBeVisible();

	const modeSwitch = page.getByLabel('Escolha entre entrar e criar conta');
	const signInMode = modeSwitch.getByRole('button', { name: 'Entrar', exact: true });
	const signUpMode = modeSwitch.getByRole('button', { name: 'Criar conta', exact: true });

	await expect(signInMode).toHaveAttribute('aria-pressed', 'true');
	await expect(signUpMode).toBeVisible();
	await expect(page.getByText('Ainda não tem uma conta?')).toBeVisible();

	await signUpMode.click();
	await expect(signUpMode).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByLabel('Senha')).toHaveAttribute('autocomplete', 'new-password');
	await expect(page.getByText('A conta pública usa o mesmo Fichário')).toBeVisible();
});
