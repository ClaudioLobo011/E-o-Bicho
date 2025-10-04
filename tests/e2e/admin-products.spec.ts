import { test, expect } from '@playwright/test';

test('admin consegue cadastrar produto no painel', async ({ page }) => {
  await page.goto('/conta');
  await page.getByLabel('E-mail ou CPF').fill('fernando.melo@eobicho.com.br');
  await page.getByLabel('Senha').fill('123456');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.goto('/admin/produtos');
  await expect(page.getByRole('heading', { name: 'Catálogo de produtos' })).toBeVisible();

  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('ID').fill('produto-teste-01');
  await page.getByLabel('Nome').fill('Produto Teste Playwright');
  await page.getByLabel('Categoria').fill('Testes');
  await page.getByLabel('Marca').fill('QA Labs');
  await page.getByLabel('Preço').fill('199.90');
  await page.getByLabel('Estoque').fill('5');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByText('Produto cadastrado com sucesso.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Produto Teste Playwright' })).toBeVisible();
});
