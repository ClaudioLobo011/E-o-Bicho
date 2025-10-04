# Migração para SPA do painel administrativo

Este repositório iniciou a transição do painel interno baseado em HTML estático para uma Single Page Application (SPA) em React + TypeScript. Esta página documenta o estado atual, como executar o projeto e como evoluir a migração.

## Como executar

```bash
npm install
npm run dev
```

O shell do painel continua acessível em `http://localhost:5173/app` (ou `http://localhost:5173/admin.html`). Um plugin de desenvolvimento no `vite.config.ts` intercepta requisições que começam com `/app` e responde com `admin.html`, mantendo o site público original (`index.html`) intacto. Em produção, configure o servidor (Express, Nginx etc.) para servir `admin.html` sempre que a rota iniciar com `/app`, permitindo que o storefront tradicional permaneça no `index.html` original.

### Outros scripts

- `npm run build`: build de produção
- `npm run preview`: pré-visualização do build
- `npm run lint`: checagem ESLint
- `npm run typecheck`: validação TypeScript
- `npm run test:e2e`: suíte de testes E2E (Playwright)

## Estrutura de pastas relevante

```
admin.html
src/
  App.tsx
  main.tsx
  components/
    TabBar.tsx
    UnsavedGuard.tsx
  context/
    TabsContext.tsx
  layouts/
    TabsLayout.tsx
  legacy/
    compat-link-adapter.ts
    route-manifest.ts
  pages/
    HomePage.tsx
    <Uma página por HTML legado>
  routes/
    index.tsx
    tab-registry.ts
  styles/
    globals.css
routes.legacy.json
```

## Rotas legadas

O arquivo `routes.legacy.json` lista todas as rotas HTML originais do painel e o caminho correspondente na SPA. Cada arquivo legado (`pages/admin/**/*.html` e `pages/admin.html`) recebeu um bloco de redirecionamento automático que:

1. Faz refresh imediato para a rota SPA equivalente.
2. Preserva `?query` e `#hash` originais.
3. Força o `tab` apropriado via `URLSearchParams`.

## Sistema de abas

- A aba "Página Principal" (home) é fixa e sempre carregada.
- Demais abas abrem sob demanda ao navegar para sua rota (`/app/<slug>` ou `?tab=<id>`).
- As abas abertas permanecem montadas, preservando estado interno dos componentes.
- Atalhos suportados:
  - `Ctrl + 1..9`: ativa a aba n-ésima
  - `Ctrl + ←/→`: percorre abas abertas
  - `Ctrl + W`: fecha a aba ativa (exceto Home)

## Como adicionar uma nova página/aba

1. Crie o HTML original em `pages/admin` (se necessário) e atualize `routes.legacy.json` com a nova entrada.
2. Gere um componente React correspondente em `src/pages/<NomeDaPagina>.tsx`.
3. Registre a página em `src/routes/tab-registry.ts` atribuindo `id`, `title` e `route`.
4. Opcionalmente, expanda `routes.legacy.json` por script (`scripts/` pode receber utilitário futuro).
5. O redirecionamento legado pode ser reaplicado executando o script Python utilizado neste commit (ver histórico do repo) ou inserindo manualmente o bloco `<script data-spa-redirect>` no HTML.

## Referências fiscais (NF-e, NFC-e, NFS-e)

- **NF-e (Nota Fiscal Eletrônica)** – portal oficial da SEFAZ nacional com esquemas XML, manual de orientação do contribuinte e exemplos de eventos: <https://www.nfe.fazenda.gov.br/portal/principal.aspx>
- **NFC-e (Nota Fiscal do Consumidor Eletrônica)** – ambiente oficial com documentação técnica, lotes de exemplo e notas modelo para homologação: <https://www.nfce.encat.org/desenvolvedor/documentos-tecnicos>
- **NFS-e (Nota Fiscal de Serviços Eletrônica padrão nacional)** – repositório do projeto ABRASF/Receita Federal com layout unificado e exemplos XML: <https://www.gov.br/nfse/pt-br/documentos-tecnicos>

Utilize essas fontes para validar layouts, códigos fiscais e regras de negócio ao migrar formulários relacionados à emissão de documentos fiscais eletrônicos.

## Próximos passos

- Migrar o markup e lógica de cada página legado para componentes React (substituindo os placeholders atuais).
- Extrair chamadas de API para `src/services` e encapsular integrações existentes.
- Implementar guarda real de alterações não salvas em `UnsavedGuard`.
- Criar suíte Playwright cobrindo os fluxos descritos na especificação (abertura/alternância/atalhos).
- Ajustar estilos Tailwind para refletir 100% das telas originais.
- Integrar dados reais de NFe/NFCe/NFSe conforme solicitado.
