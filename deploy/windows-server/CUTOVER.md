# Checklist de cutover e rollback

## Antes da janela

- [ ] Confirmar que a Render continua `live`; não suspender nem excluir.
- [ ] Confirmar `git status` limpo e registrar o commit em produção.
- [ ] Executar testes do backend e o `Check-EoBichoMigration.ps1`.
- [ ] Fazer backup offline do `.env` local sem colocar o arquivo no Git.
- [ ] Registrar a tarefa automática com `Install-EoBichoAutostart.ps1`, sem
      `-StartNow` enquanto o processo manual estiver ativo.
- [ ] Confirmar energia estável, retorno automático após queda no BIOS e que o
      Windows não reiniciará por atualização durante a janela.
- [ ] Manter a Render ativa por pelo menos 24 a 48 horas após a troca do
      frontend para permitir rollback imediato.

## Virada

1. Parar somente o processo Node manual da porta 3000. Ele foi iniciado antes
   do commit atualmente publicado e precisa ser substituído para carregar o
   código preparado. Não parar o serviço `Cloudflared`, pois ele já recebe
   callbacks externos.
2. Iniciar a tarefa `EoBicho-API` e confirmar:
   - `http://127.0.0.1:3000/healthz` -> HTTP 200;
   - `http://127.0.0.1:3000/readyz` -> HTTP 200 e banco `ready`;
   - `https://callback.peteobicho.com.br/` -> HTTP 200.
3. Na Cloudflare, no tunnel existente `ifood-webhook`, adicionar uma única
   aplicação publicada:
   - hostname: `api.peteobicho.com.br`;
   - path: vazio;
   - service/origin: `http://localhost:3000`;
   - não remover nem editar as cinco rotas atuais de `callback`.
4. Validar externamente:
   - `https://api.peteobicho.com.br/healthz` -> HTTP 200;
   - `https://api.peteobicho.com.br/readyz` -> HTTP 200;
   - uma leitura pública pequena da API;
   - preflight CORS com origem `https://www.peteobicho.com.br`;
   - handshake Socket.IO e uma tela autenticada de baixo risco.
5. Simular a mudança do frontend:

   ```powershell
   .\Set-FrontendApiTarget.ps1 -Target Windows
   ```

6. Aplicar somente depois dos health checks:

   ```powershell
   .\Set-FrontendApiTarget.ps1 -Target Windows -Apply
   ```

7. Revisar o diff (deve mudar apenas a origem em `scripts/core/config.js`),
   executar os testes, criar commit de cutover e enviar ao `main`.
8. Esperar a Vercel publicar o mesmo commit e validar no navegador:
   login, catálogo, PDV, imagens R2, e-mail, Google Drive e uma operação de
   leitura por integração. Não realizar emissão fiscal ou cobrança apenas como
   teste.
9. Monitorar logs locais, tunnel, erros 5xx e callbacks de iFood, Mercado Pago
   e WhatsApp. As rotas externas atuais permanecem no hostname `callback`,
   portanto não precisam trocar de URL na virada da API.
10. Somente após estabilidade, suspender a Render. Preferir suspensão antes de
    exclusão para manter rollback rápido.

## Webhooks e callbacks preservados

O tunnel atual encaminha para `localhost:3000`:

- `/`;
- `/webhooks`;
- `/webhooks/marketplaces`;
- `/webhooks/whatsapp`;
- `/webhooks/mercadopago`.

No backend também existem os aliases `/webhook`, `/webhook/whatsapp` e as
rotas de API das integrações. O iFood está habilitado por polling/eventos; o
Mercado Pago está habilitado, mas o estado salvo estava offline na inspeção. A
integração WhatsApp estava `in_progress`, com dois números e sem registro de
assinatura de webhook concluída. Essas situações devem ser rechecadas na hora,
sem inventar callbacks ou alterar tokens.

## Rollback imediato

1. Manter a rota `api.peteobicho.com.br` no tunnel enquanto o diagnóstico é
   feito; ela não impede a volta do frontend.
2. Trocar a origem local de volta para Render:

   ```powershell
   .\Set-FrontendApiTarget.ps1 -Target Render -Apply
   ```

3. Revisar o diff, publicar o commit de rollback e aguardar a Vercel.
4. Confirmar que `www.peteobicho.com.br` voltou a chamar
   `https://e-o-bicho.onrender.com/api`.
5. Se a Render tiver sido suspensa, reativá-la e esperar o estado `live` antes
   de publicar o rollback do frontend.
6. Não remover as rotas de `callback`: elas já dependem do PC antes mesmo do
   cutover do frontend. Se o PC estiver indisponível, restaurar primeiro a API
   local/tunnel e tratar cada provedor conforme sua fila/retry.

## Critério para desativar a Render

- health e readiness externos estáveis;
- tarefa de boot testada com reboot autorizado pelo usuário;
- tunnel automático saudável após reboot;
- frontend Vercel confirmado usando o hostname novo;
- callbacks reais recebidos sem 4xx/5xx;
- Socket.IO e PDV validados;
- logs sem reinício contínuo ou falha de MongoDB;
- rollback testado ou, no mínimo, ensaiado até o ponto anterior à publicação.
