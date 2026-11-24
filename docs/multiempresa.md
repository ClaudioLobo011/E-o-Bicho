# Seleção da empresa

O cadastro dos perfis fica em `scripts/core/config.js`, no objeto `COMPANY_PROFILES`. Cada entrada reúne nome, domínios, marca, dados públicos, nome do banco, porta da API e páginas personalizadas. A variável `SITE_EMPRESA` seleciona a entrada por processo ou publicação. A configuração padrão continua sendo `e_o_bicho`.

## Prévia local

```powershell
$env:SITE_EMPRESA = 'palace_do_pet'
npm run frontend:local
```

O site abre na porta 5500 e usa a API local da empresa, na porta indicada pelo perfil. `FRONTEND_PORT` e `FRONTEND_API_URL` permitem rodar uma segunda prévia em paralelo.

## Publicação do site

Preencha `siteUrl` e `apiUrl` no perfil. Indique a logo e, em `pageOverrides`, os templates específicos de ajuda e privacidade, quando estiverem disponíveis. O pacote gerado fixa o perfil tanto no navegador quanto nas rotas do catálogo, de recomendações e de detalhe do produto.

```powershell
$env:SITE_EMPRESA = 'palace_do_pet'
npm run frontend:empresa
```

O comando informa o caminho da pasta preparada para a publicação. O perfil da Palace do Pet está em prévia até a definição dos endereços públicos. Os dados jurídicos e os arquivos de marca da E o Bicho não são usados nesses campos da Palace.

## API

Para uma empresa nova, inicie a API com `SITE_EMPRESA` e `SITE_ENV_FILE` definidos no processo. O arquivo indicado deve conter a `MONGO_URI` completa com o nome do banco no caminho e o `JWT_SECRET` exclusivo da empresa. Segredos e credenciais de integrações devem ficar fora do repositório e do pacote do site.

A API valida o banco e a permissão `readWrite` exclusiva antes de conectar os modelos. A origem padrão do navegador é a do site indicado no perfil. A API guarda os uploads locais e os backups em uma subpasta própria junto ao diretório do arquivo de ambiente. Cada implantação deve configurar seus próprios provedores externos.
