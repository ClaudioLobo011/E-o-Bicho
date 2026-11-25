# Manutenção deste repositório

## Sincronização com produção

- Ao iniciar um trabalho, confira a branch, o remoto, `git status --short` e os ambientes envolvidos. A pasta da instalação pode conter commits locais de configuração.
- Faça trabalho ainda não autorizado para produção em worktree ou branch isolada. Preserve mudanças existentes, arquivos privados e dados. Não use reset destrutivo, exclusão ou stash para esconder pendências.
- Quando uma publicação estiver autorizada, publique só os arquivos e commits da tarefa. Compare o que ficou no Git com o site público, o processo da API e os canais de atualização envolvidos. Um push bem-sucedido não comprova implantação.
- Ao encerrar, mantenha a pasta de trabalho usada no VS Code sem arquivos pendentes (`git status --porcelain` vazio). Integre nela os commits publicados e preserve o histórico da instalação. Se faltar autorização ou houver divergência, registre o que falta e preserve o trabalho em separado.
