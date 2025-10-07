# Reorganização de XMLs fiscais no Google Drive

Para mover os arquivos XML já enviados para o Google Drive para a nova estrutura de pastas (`Empresa/PDV/Ano/Mês/Dia`), utilize o script de manutenção incluído no projeto.

## Pré-requisitos

- Configure as variáveis de ambiente em `servidor/.env` necessárias para autenticar no banco de dados e no Google Drive (as mesmas usadas em produção para emitir documentos fiscais).
- Garanta que a aplicação tenha acesso à internet para comunicar-se com a API do Google Drive.

## Passos

1. Acesse a pasta do servidor:

   ```bash
   cd servidor
   ```

2. (Opcional) Execute um ensaio sem alterações reais para conferir o que será movido:

   ```bash
   npm run drive:reorganize-fiscals:dry-run
   ```

   O comando mostra cada arquivo (`fileId`) e o destino calculado, mas não efetua nenhuma alteração. Se o ID tiver sido recuperado a partir do link (`fiscalXmlUrl`) legado, o log indicará "id extraído do link".

3. Quando estiver tudo certo, execute a reorganização definitiva:

   ```bash
   npm run drive:reorganize-fiscals
   ```

   O script conecta ao banco, localiza vendas fiscais com arquivos no Drive (considerando tanto `fiscalDriveFileId` quanto, quando possível, o `fiscalXmlUrl` antigo) e move cada documento para a pasta correspondente à empresa, PDV e data de emissão. Ao final é exibido um resumo com a quantidade de arquivos processados, movidos, ignorados e possíveis erros, incluindo o motivo (sem PDV, sem ID no Drive, etc.).

4. Se o comando retornar **"Nenhuma venda fiscal com referência ao Google Drive foi localizada"**, significa que os registros existentes não possuem `fiscalDriveFileId` nem um link reconhecível em `fiscalXmlUrl`. Nesse caso, revise se as notas foram emitidas após a integração com o Drive ou atualize manualmente os registros com o ID correto antes de rodar o script novamente.

## Dicas

- Se algum arquivo apresentar erro, o `fileId` será mostrado no log. Após corrigir o problema (por exemplo, permissões no Drive), você pode rodar o comando novamente; apenas os itens restantes serão reposicionados.
- Para executar somente para uma base de homologação, defina as variáveis de ambiente de homolog antes de rodar os comandos.
