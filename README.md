# E o Bicho — SPA React

Projeto modernizado do e-commerce e painel administrativo da E o Bicho utilizando Vite, React, TypeScript e TailwindCSS.

## Tecnologias

- [Vite](https://vitejs.dev/) + React + TypeScript
- TailwindCSS com plugin de formulários
- React Router v6
- Zustand para estado global (auth e carrinho)
- TanStack Query para dados remotos (mockados)
- React Hook Form + Zod para formulários tipados
- Playwright para testes de ponta a ponta

## Instalação

```bash
npm install
```

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor Vite em modo desenvolvimento (porta 5173 por padrão). |
| `npm run build` | Gera build de produção (`dist/`). |
| `npm run preview` | Executa o build localmente para homologação. |
| `npm run lint` | Executa ESLint. |
| `npm run test` | Executa testes unitários/integrados com Vitest (placeholder). |
| `npm run test:e2e` | Roda os testes E2E com Playwright (necessário `npm run dev` em paralelo). |
| `npm run typecheck` | Analisa os tipos com TypeScript sem emitir arquivos. |

## Estrutura

```
src/
  app/              # Layout raiz e roteamento
  admin/            # Painel administrativo (layouts e módulos)
  entities/         # Tipos de domínio (User, Product, Order...)
  features/         # Lógica de estado (auth, cart, account, products)
  pages/            # Páginas da SPA (home, conta, carrinho, produtos, checkout)
  shared/           # Componentes base, API client, mocks, utilidades
  styles/           # Estilos globais Tailwind
```

## API Mockada

Enquanto o backend não é integrado, todas as chamadas utilizam mocks em `src/shared/api/mocks`. O cliente HTTP (`src/shared/api/client.ts`) inclui interceptors para reaproveitar o token armazenado na chave legacy `loggedInUser` e replicar as chaves fiscais oficiais usadas nos fluxos de pedidos (NFC-e, NF-e, NFS-e).

## Persistência

- Sessão (`loggedInUser`) e lembrar acesso (`rememberLogin`) reaproveitam as mesmas chaves do projeto original.
- Carrinho persiste no `localStorage` com a chave `eobicho.cart.v1`.
- A função `applyStorageMigrations()` é executada no bootstrap para migrar dados legacy automaticamente.

## Servir sob a mesma origin

Para manter o mesmo host/porta/domínio do projeto legado, sirva o build gerado pelo Vite por trás do servidor atual (Node/Nginx) com fallback de histórico. Exemplo de configuração Nginx:

```
location / {
  try_files $uri /index.html;
}
```

Dessa forma, todas as rotas SPA (`/conta/meus-dados`, `/carrinho`, `/admin/produtos`, etc.) continuam acessíveis pelo mesmo origin, preservando o `localStorage` existente.

## Testes E2E

Os cenários críticos já estão cobertos:

1. Login de cliente e edição de dados pessoais (`tests/e2e/login-account.spec.ts`).
2. Catálogo → Carrinho → Checkout (`tests/e2e/cart-checkout.spec.ts`).
3. CRUD de produtos no painel administrativo (`tests/e2e/admin-products.spec.ts`).

Execute `npm run test:e2e` com o servidor `npm run dev` ativo para rodar os testes.

## Dados fiscais de referência

Os mocks de pedidos expõem chaves NFC-e/NF-e/NFS-e de ambientes de homologação publicados pelas Secretarias da Fazenda do Paraná, Rio Grande do Sul e Prefeitura de São Paulo, facilitando a validação contra fontes oficiais durante o desenvolvimento.
