import { test, expect } from '@playwright/test';

test('cliente consegue acessar e atualizar seus dados', async ({ page }) => {
  await page.goto('/conta');

  await page.getByLabel('E-mail ou CPF').fill('julia.souza@cliente.com');
  await page.getByLabel('Senha').fill('123456');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Informações pessoais' })).toBeVisible();

  const phoneField = page.getByLabel('Telefone');
  await phoneField.fill('(11) 90000-0000');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(page.getByText('Dados atualizados com sucesso!')).toBeVisible();
  await expect(phoneField).toHaveValue('(11) 90000-0000');
});
