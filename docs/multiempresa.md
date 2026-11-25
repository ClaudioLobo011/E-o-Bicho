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

## Acesso do admin master

A E o Bicho é a origem da identidade do admin master. Nas demais empresas, o admin master usa o formulário habitual de login com e-mail, celular, CPF ou CNPJ já cadastrados na origem. Depois de validar o identificador e a senha, o formulário pede o código do autenticador. Cada empresa emite sua própria sessão de uma hora com o `JWT_SECRET` local. O primeiro login cria um vínculo de auditoria no banco da empresa, sem copiar a senha ou o segredo do autenticador. Um cadastro local já existente com o mesmo identificador mantém seu acesso local.

Na máquina que roda as empresas lado a lado, use um arquivo privado `.private/master-auth.json` na pasta que contém as instalações. Ele deve reunir `subject` (ID exato do admin master no banco da origem), `email` (e-mail atual da conta), `origin` (endereço HTTP local da API de origem em `127.0.0.1`, com porta) e `secret` (32 bytes aleatórios codificados em base64url). Restrinja a leitura aos processos das APIs. `MASTER_AUTH_CONFIG_FILE` permite apontar para outro local. Cada nova instalação na mesma pasta herda essa configuração, com banco e chave JWT próprios.

Use `masterIdentifierDigests` para preencher `identifierDigests` no arquivo privado a partir do cadastro master. Atualize essa lista se o celular, CPF ou CNPJ da origem mudar. O arquivo guarda HMACs dos identificadores numéricos. A origem confere os dados atuais da conta antes de autorizar o acesso.

Em produção, a origem precisa de `TOTP_SECRET_KEY` própria com pelo menos 32 bytes. Ao substituir a chave de um ambiente existente, preserve os autenticadores já cadastrados atualizando os segredos cifrados junto com a chave. Valide um login completo após ativar a empresa de destino. A conta de origem usa seus próprios recursos de recuperação. O acesso rápido por e-mail ou por código avulso fica desativado para o usuário master vinculado.
