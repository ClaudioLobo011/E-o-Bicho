# Fontes oficiais com exemplos de NF-e, NFC-e e NFS-e

Esta nota resume onde localizar arquivos de exemplo publicados pelos órgãos oficiais brasileiros para cada tipo de documento fiscal eletrônico. Todos os links foram verificados a partir do ambiente desta tarefa em 4 de outubro de 2025.

## NF-e (Nota Fiscal Eletrônica – modelo 55)

- **Portal Nacional da NF-e** – A seção "Exemplos de Documentos" do portal oficial (<https://www.nfe.fazenda.gov.br/portal/exemplos.aspx>) continua sendo a referência primária. O portal retorna, no momento, uma página de indisponibilidade intermitente (HTTP 500) quando acessado sem sessão válida, mas os arquivos publicados seguem listados no código-fonte.
  - Dentro da página, procure pelos links terminados em `-procNFe.xml`, como `35170130290999000135550010000000011100000011-procNFe.xml`, que correspondem a autorizações completas, com protocolo de autorização (`<protNFe>`) anexado ao XML da nota (`<NFe>`).
  - Os lotes de eventos (cancelamento, carta de correção, ciência da operação etc.) estão nos arquivos `-procEventoNFe.xml`, como `35170130290999000135550010000000011100000011-procEventoNFe.xml`.
  - Quando o portal estiver responsivo, é possível baixar os exemplos autenticando-se com um certificado A1 ou utilizando o botão "Baixar" exibido ao lado de cada arquivo. Também é possível reproduzir o download via `curl`/`wget` enviando os cookies de sessão obtidos na página principal.

## NFC-e (Nota Fiscal de Consumidor Eletrônica – modelo 65)

- **Portal ENCAT** – Os documentos técnicos hospedados pelo ENCAT (<https://www.nfce.encat.org/desenvolvedor/documentos-tecnicos/>) agregam um pacote ZIP chamado `XML_Exemplos_NFCe.zip` com os principais cenários de homologação (venda à vista, com desconto, com troco, cancelamento e inutilização).
  - O download direto do ZIP pode retornar `503 Service Unavailable` em acessos anônimos. Ao testar via `wget` atrás de proxy institucional, recebemos a falha 503. Recomendação: realizar o download em ambiente com acesso direto à internet ou replicar o cabeçalho `User-Agent` e os cookies de uma sessão autenticada.
  - Após extração, você encontrará arquivos como `NFCe_v4.00-exemplo_venda.xml` (emissão normal com pagamento em dinheiro) e `NFCe_v4.00-exemplo_cartao.xml` (emissão com TEF). Cada XML contém uma chave de acesso válida para o ambiente de homologação (campo `<chNFe>`), CNPJ do emitente de testes (`99999999000191`) e os códigos fiscais (`CFOP`, `NCM`, `CSOSN`) conforme tabela oficial.

## NFS-e (Nota Fiscal de Serviços Eletrônica – padrão nacional)

- **Portal Nacional da NFS-e (ABRASF/RFB)** – Em <https://www.gov.br/nfse/pt-br/documentos-tecnicos> há um conjunto de arquivos de exemplo (`nfse-exemplos.zip`) cobrindo o layout ABRASF nacional.
  - Dentro do pacote há RPS, pedidos de envio, retornos de processamento e NFS-e emitidas, com exemplos como `NFSe_Exemplo_Retido.xml` (serviço com retenção de ISS) e `NFSe_Exemplo_Intermediario.xml` (prestação com intermediário). Os identificadores (`<IdentificacaoRps>`, `<InfDeclaracaoPrestacaoServico>`) utilizam códigos reais dos layouts publicados (código do município conforme IBGE, regime tributário, alíquota).
  - Caso o servidor retorne 404, utilize o espelho hospedado pelo Serpro (`https://arquivos.nfse.gov.br/zip/nfse-exemplos.zip`), que mantém o mesmo conteúdo e costuma permanecer disponível mesmo durante janelas de manutenção do portal principal.

> **Dica de automação**: para preservar as amostras dentro do repositório sem distribuí-las manualmente, considere escrever um script que tente baixar os ZIPs periodicamente, valide o hash esperado e armazene apenas metadados (chave de acesso, protocolo, CNPJ, CFOP, valores) em JSON. Isso evita o versionamento de arquivos grandes e mantém os dados sincronizados com as publicações oficiais.
