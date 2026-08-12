# Preparação da migração Render -> PC Windows

Estes arquivos deixam a API pronta para uma virada controlada sem alterar a
produção antecipadamente. Nenhum script desta pasta é executado por deploy,
por `npm start` ou pela Vercel.

## Estado confirmado em 12/08/2026

- A Render executa o commit `a6890fa` do branch `main`, com raiz `servidor`,
  build `npm install; npm run build` e start `npm start`.
- A Render não tem health check nem domínio personalizado. A URL ativa é
  `https://e-o-bicho.onrender.com` e o auto-deploy ocorre em cada commit.
- As 29 variáveis configuradas na Render existem por nome no `.env` local. Os
  valores não foram copiados, exibidos ou registrados nesta documentação.
- A API já está em execução manual no PC em `localhost:3000`, mas não havia
  tarefa automática para recuperá-la após reboot ou falha. Esse processo foi
  iniciado em 10/08, antes do commit de produção capturado em 12/08; portanto,
  ele deve ser tratado como código carregado potencialmente desatualizado e
  reiniciado de forma controlada somente na janela de virada.
- O serviço Windows `Cloudflared` já é automático. O tunnel `ifood-webhook`
  está saudável e publica cinco rotas de `callback.peteobicho.com.br` para
  `http://localhost:3000`.
- `api.peteobicho.com.br` ainda não existe no DNS/tunnel. Isso é intencional:
  criar a rota agora alteraria produção antes da autorização de cutover.
- O frontend Vercel usa `scripts/core/config.js` e aponta por padrão para a
  Render. Os domínios são `www.peteobicho.com.br`, o apex com redirect 307 e o
  domínio Vercel do projeto.
- MongoDB Atlas `EoBicho` está pronto, M10, AWS São Paulo, replica set de três
  nós. A lista de rede permite `0.0.0.0/0` e os backups estão inativos; esses
  dois itens são riscos de segurança/continuidade, não bloqueios da migração.

## Arquivos

- `Run-EoBichoApi.ps1`: supervisor contínuo da API; reinicia o Node após falha.
- `Install-EoBichoAutostart.ps1`: registra a tarefa `EoBicho-API` no boot.
- `Stop-EoBichoApi.ps1`: parada protegida, somente se a porta pertencer a
  `node server.js`.
- `Check-EoBichoMigration.ps1`: pré-flight sanitizado; nunca imprime valores do
  `.env`.
- `Set-FrontendApiTarget.ps1`: troca exata e reversível entre Render e Windows.
- `migration-manifest.json`: fotografia sem segredos dos serviços inspecionados.
- `CUTOVER.md`: ordem operacional da virada e rollback.

## Preparação local que ainda exige autorização para ativar

Em PowerShell como Administrador:

```powershell
Set-Location 'D:\SCripts\E o Bicho\SiteEoBichoTW\deploy\windows-server'
.\Install-EoBichoAutostart.ps1
```

Esse comando registra a tarefa, mas não reinicia a API atual. Use `-StartNow`
somente na janela de virada, depois de encerrar de forma controlada o processo
manual hoje responsável pelos callbacks.

O serviço `Cloudflared` existente deve ser preservado. Não instale um segundo
serviço nem gere outro token sem necessidade.
