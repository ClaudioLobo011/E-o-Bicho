import { test, expect } from '@playwright/test';

test('fluxo de compra do catálogo ao checkout', async ({ page }) => {
  await page.goto('/produtos');

  await expect(page.getByRole('heading', { name: 'Produtos' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver detalhes' }).first().click();

  await expect(page.getByRole('heading', { name: /Ração|Produto/i })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();

  await page.getByRole('link', { name: /Carrinho/ }).click();
  await expect(page.getByRole('heading', { name: 'Meu carrinho' })).toBeVisible();
  await expect(page.getByText('Subtotal')).toBeVisible();

  await page.getByRole('link', { name: 'Finalizar compra' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

  await page.getByLabel('Nome completo').fill('Cliente Teste');
  await page.getByLabel('CPF').fill('000.000.000-00');
  await page.getByLabel('Telefone').fill('(11) 98888-7766');
  await page.getByLabel('Rua').fill('Rua Teste');
  await page.getByLabel('Número').fill('123');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('CEP').fill('00000-000');
  await page.getByLabel('Número do cartão').fill('4111 1111 1111 1111');
  await page.getByLabel('Validade').fill('12/29');
  await page.getByLabel('CVV').fill('123');

  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Pedido confirmado!')).toBeVisible();
});
