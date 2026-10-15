# Recebimento de romaneios — site e TC57

Este fluxo prepara o documento, guarda as leituras do coletor e permite conferir a mercadoria antes de movimentar o estoque. O recebimento permanece em rascunho até a conclusão explícita no site.

## Atualizar o TC57

Instale `ContagemEstoque-TC57-v1.1.0.apk` sobre o aplicativo de contagem existente. Esta distribuição usa o pacote `br.com.eobicho.contagem.debug` e mantém a assinatura da distribuição anterior 1.0.6. **Não desinstale o aplicativo nem limpe seus dados.** Se o Android recusar a atualização por incompatibilidade de assinatura ou se o pacote instalado for diferente, obtenha o APK compatível antes de continuar.

Abra **Romaneios** no aplicativo, informe o usuário e a senha do sistema e toque em **Autorizar recebimentos**. A autorização do coletor é própria para recebimentos. Toque em **Sincronizar** para carregar os recebimentos e o catálogo disponíveis para sua conta.

O TC57 utiliza o leitor integrado pelo **DataWedge**, acionado pelo gatilho lateral, sem precisar abrir a câmera ou manter um campo de texto selecionado. O aplicativo configura seu perfil ao abrir, usando o leitor interno e entrega por Intent, com saída de teclado desativada nesse perfil. Se a leitura não aparecer, confira o estado do leitor nas configurações do aplicativo e use a opção de reconfigurar o DataWedge.

## Primeiro uso: testar sem movimentar estoque

1. No site, acesse **Compras → Fornecedores → Recebimento de Romaneios**.
2. Clique em **Novo recebimento**, escolha loja e depósito, informe fornecedor e referência e mantenha **Modo de teste** marcado.
3. Anexe fotos ou comece uma conferência livre.
4. No TC57, sincronize e abra o mesmo recebimento.
5. Faça as leituras, confira no site e conclua o teste pela revisão.

Um teste concluído não movimenta o estoque. Para uma entrada real, use um recebimento real separado ou altere o modo do rascunho no site antes da revisão final. Um teste já concluído permanece encerrado.

## Fotos e preparação das linhas

Fotografe todas as páginas, com a folha inteira visível, iluminação uniforme e sem outra folha cobrindo produtos. O site aceita até **8 fotos por envio**, com até **8 MB por foto**, nos formatos JPEG, PNG ou WebP.

Selecione as fotos e clique em **Preparar linhas pela foto**. A leitura ocorre no servidor e prepara uma proposta; não cadastra produtos nem confirma mercadoria recebida. É possível continuar trabalhando durante o processamento.

Na proposta, confira descrições, códigos do fornecedor, quantidades, unidades e custos. Páginas aparentemente repetidas são sinalizadas; duas fotos da mesma página não representam duas entradas. A prévia também destaca linhas idênticas às já existentes e começa com essas linhas desmarcadas.

Impressão fraca, foto inclinada, dobras e trechos cortados podem impedir a leitura correta. Use **Conferir e corrigir o texto lido**, selecione a foto, corrija o texto e clique em **Preparar linhas do texto corrigido**. Também é possível adicionar uma linha manualmente.

Resultados de baixa qualidade são identificados como leitura insuficiente. A prévia abre mesmo sem produtos reconhecidos, preservando o texto bruto e o acesso à foto. Linhas incertas começam desmarcadas e só podem ser adicionadas após seleção e confirmação explícita da conferência. O reconhecimento local não comprova códigos, valores ou produtos, mesmo quando apresenta confiança alta.

### Usar a conversa do ChatGPT sem API paga

Em **Preparar com o ChatGPT**, copie o pedido pronto e envie-o junto das fotos na conversa que você já utiliza. Cole a resposta JSON no campo da tela e clique para conferir as linhas. Também é possível importar o arquivo JSON recebido. Essa opção é manual: não conecta sua conta, não lê suas conversas, não envia fotos automaticamente e não chama uma API paga. O uso da conversa continua sujeito aos limites do seu plano.

O pedido orienta deixar campos ilegíveis em branco e separar códigos do fornecedor dos códigos de barras. A importação mantém recebimento, conversão e revisão pendentes; a bipagem e a conferência continuam necessárias.

Como alternativa, importe CSV ou JSON. O botão **Baixar modelo de CSV** fornece os cabeçalhos:

```text
descricao;codigoFornecedor;quantidadeEsperada;unidade;custoUnitario;codigoDeBarras;pagina;item
```

Deixe valores desconhecidos em branco. Preserve códigos como texto para manter zeros à esquerda. JSON aceita um vetor de linhas ou um objeto com `lines`, usando os campos `description`, `supplierCode`, `expectedQuantity`, `unit`, `unitCost` e `barcode`. Toda importação passa por uma prévia; ela prepara quantidades esperadas e não soma quantidades recebidas.

## Identificar e contar são ações diferentes

- **Conferir / contar:** cada bip soma a quantidade recebida. No TC57, a opção **Bipar e informar quantidade** permite bipar uma embalagem e informar o total recebido.
- **Identificar:** selecione a linha do documento e bipe a embalagem. Associa o código à linha sem somar quantidade.
- **Código desconhecido:** a leitura permanece guardada e a linha fica pendente de vínculo. Procure o cadastro existente antes de criar outro produto.

No site, **Vincular produto** busca por nome, código interno ou código de barras. Se for necessário cadastrar um produto, abra **Cadastro de produtos**, conclua o cadastro com dados conferidos, volte ao recebimento e use **Atualizar catálogo** para vinculá-lo. O fluxo não inventa custo ou preço de venda.

Uma referência impressa na coluna “Código” do fornecedor não é automaticamente o código de barras da embalagem. Os dois campos permanecem separados.

## Embalagens, diferenças e correções

Confira a **unidade recebida** e as **unidades de estoque por unidade recebida**. A descrição “C/30” não determina sozinha a conversão: uma unidade recebida pode ser um pacote vendido fechado. Defina o fator conforme o cadastro e a operação efetiva, marque **Conferi a conversão** e depois **Linha revisada**.

Quantidade esperada e recebida ficam separadas. Os filtros mostram produtos sem vínculo, conversões pendentes, faltas e sobras. Ajustes manuais da quantidade recebida ficam registrados no histórico. Uma leitura errada pode ser desfeita; o registro original é preservado.

O site atualiza as leituras automaticamente e preserva as edições locais. Se outra pessoa alterar o mesmo campo, escolha o valor correto no aviso de conflito antes de salvar. Novas leituras durante a revisão final exigem abrir novamente a revisão para conferir os valores atualizados.

## Sem internet

No TC57, as leituras são guardadas no aparelho e reenviadas quando a conexão retorna. Confira o indicador de leituras aguardando envio e use **Sincronizar** quando necessário. Um produto ausente do catálogo local ainda precisa ser verificado no servidor; isso não prova que ele não tenha cadastro.

No site, leituras digitadas ou recebidas pelo leitor de teclado também ficam em uma fila local do navegador até a confirmação do servidor. Não limpe os dados do aplicativo ou do navegador enquanto houver pendências. Reenviar o mesmo registro não soma novamente; dois bips distintos do mesmo produto somam duas leituras.

Uma leitura rejeitada pelo servidor fica na área de leituras para tentar novamente após corrigir o vínculo ou descartar explicitamente a tentativa. As demais leituras continuam sendo enviadas. O histórico da rejeição permanece no navegador e na exportação JSON. Falhas temporárias de conexão continuam aguardando envio.

## Revisar e concluir

Salve as alterações e clique em **Revisar e concluir**. Confira depósito, vínculos, quantidades e conversões. Aceite expressamente eventuais faltas ou sobras. A aprovação real exige uma conta com permissão administrativa e registra a entrada no estoque de forma transacional; tentativas repetidas de concluir não devem duplicar a entrada.

A conclusão não altera preços de venda, custos do cadastro, promoções ou contas a pagar. O custo informado no romaneio fica documentado no recebimento e no histórico correspondente.

Na aprovação real há duas opções, inicialmente desmarcadas:

- **Lembrar os vínculos de códigos deste fornecedor:** memoriza a relação do fornecedor com o produto e a conversão conferida para próximos documentos. Vínculos conflitantes não são sobrescritos automaticamente.
- **Lembrar códigos bipados:** guarda uma associação própria dos recebimentos. Não troca o código principal nem modifica os códigos do catálogo ou do PDV.

O recebimento pode ser exportado em JSON ou CSV para conferência. As fotos originais permanecem anexadas.

## Motor de reconhecimento local

O servidor pode usar RapidOCR/PP-OCRv6 com modelos instalados localmente, sem serviço de IA pago. A instalação usa Python 3.10 em `servidor/.receiving-ocr-local`, o arquivo `servidor/scripts/requirements-receiving-ocr.txt` e o comando `servidor/scripts/receiving-ocr.py --prepare`. O arquivo `ready.json` só deve ser criado após a preparação e a verificação dos modelos. A implementação usa processos com janela oculta e limita tempo, saída e paralelismo. Imagens temporárias são removidas ao terminar.

Sem esse runtime pronto, permanece disponível o Tesseract local anterior. A versão do motor é registrada na extração. Ao solicitar nova leitura, resultados de uma versão anterior são reprocessados; a consulta dos resultados antigos também aplica os avisos de qualidade atuais. Nenhum desses motores dispensa revisão.

## Verificação no aparelho

Compilação e testes automatizados não substituem a validação no TC57 físico. Antes de entradas reais, confira instalação sobre a versão existente, gatilho/DataWedge, bips rápidos e repetidos, perda e retorno da conexão, fechamento e reabertura do aplicativo, identificação sem contagem, caixas/pacotes e conclusão em modo de teste. Registre separadamente qualquer etapa que ainda não tenha sido executada no aparelho.
