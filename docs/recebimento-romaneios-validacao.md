# Validação do recebimento por romaneios — 15/10/2026

## Entrega

- Android 1.1.0, versionCode 8, package `br.com.eobicho.contagem.debug`.
- APK com a mesma assinatura da distribuição 1.0.6; atualização sem desinstalação.
- SHA-256: `5DA4E8F5F6AB9615AC0054B2F656517F74213301829D5E02141A1D57A0A42332`.
- Download: https://api.peteobicho.com.br/receiving/ContagemEstoque-TC57-v1.1.0.apk
- Download remoto conferido por SHA-256; 18.339.783 bytes.

## Verificações automatizadas

- 75 testes Android: fila do scanner, roteamento, persistência de eventos, recuperação e reenvio.
- Build Android, lint sem erros e APK de instrumentação concluídos.
- 40 testes Node: 18 de recebimentos, 9 de fotos/documentos, 5 de extração e 8 de regressão do coletor anterior.
- Testes de recebimento usam MongoDB temporário com replica set; não utilizam estoque comercial.
- Aprovação concorrente/repetida produz um único lançamento. Conversão de embalagem é aplicada uma vez.
- Preços, custos, promoções, regras fiscais e contas a pagar permanecem intactos na aprovação.
- Fotos passam por decodificação, limite de tamanho, SHA-256 e autorização da loja; download mantém bytes exatos.
- Teste visual em Chrome isolado: login, criação de teste, código conhecido, quantidade, perda de conexão, reenvio, preservação de descrição editada e bloqueio de conflito de quantidade.
- Mais 12 testes da fila web: isolamento de rejeições, reenvio idempotente e preservação de falhas temporárias.
- Testes adicionais no navegador: foto real anexada e ampliada, importação CSV, vínculo com catálogo, identificação da linha, revisão da conversão e conclusão de teste; rejeição isolada sem travar leituras seguintes, descarte explícito e histórico preservado após recarregar.
- Tela revisada em 1440×1080 e 390×844. Nenhum erro JavaScript nesses fluxos.

## Limites verificados

- Nenhum TC57 esteve conectado. Instalação, gatilhos físicos, DataWedge e Keystore precisam ser conferidos no aparelho real.
- O leitor usado é o integrado do TC57 via DataWedge Intent; a câmera não é usada para bipagem.
- O OCR local foi experimentado nas imagens fornecidas. A impressão fraca produz leitura de baixa confiança; o sistema apresenta proposta, avisos e texto corrigível. Não há garantia de transcrição integral dessas fotos.
- No teste integrado de upload/processamento/consulta da primeira foto, o trabalho terminou em 107 segundos, com 2 linhas reconhecidas e confiança 28/100. Essa foto exige complementação manual; o processamento concluído não significa documento integralmente transcrito.
- Fotos 1 e 2 do exemplo repetem a mesma página; a continuação possui uma área encoberta. Essas lacunas precisam ser resolvidas ao preparar o documento.
- Nenhum recebimento comercial foi aprovado durante esta validação.

## Execução dos testes do servidor

```powershell
node --test servidor/routes/__tests__/receiving.test.js servidor/routes/__tests__/receivingDocuments.test.js servidor/services/__tests__/receivingPhotoExtraction.test.js servidor/routes/__tests__/stockCounter.test.js
```

O arquivo `stockCounter.test.js` pertence à integração local anterior e pode não existir em clones que não incluam essa integração. Os testes novos são os três arquivos `receiving*` acima.

## Atualização da leitura de fotos e uso da conversa — 15/10/2026

- Nenhuma API paga foi utilizada ou configurada. A opção **Preparar com o ChatGPT** copia um pedido e recebe JSON colado pelo usuário; não conecta nem automatiza sua conta.
- RapidOCR 3.10.0/PP-OCRv6 instalado localmente, com três modelos preparados e verificados. Reconhecimento limitado a dois threads de CPU; downloads de modelos desativados durante as solicitações.
- As fotos completas, sem recorte específico do fornecedor, produziram 40 linhas candidatas na primeira página mais nítida e 10 na continuação. A rotação de 270° da continuação foi identificada automaticamente. A foto alternativa da primeira página produziu 36 linhas.
- O adapter de produção Node → Python → parser foi verificado nas fotos: 21,9 s e 13,8 s. Todas as linhas exigem revisão; códigos, descrições, quantidades e valores ainda podem estar incorretos. Contagem de linhas não mede precisão da transcrição.
- Novas solicitações reprocessam caches de motores antigos. Consultas aos trabalhos antigos passam a informar qualidade insuficiente quando aplicável, preservando a evidência armazenada.
- Resultados vazios ou corrompidos abrem a prévia com texto bruto e foto. Linhas incertas começam desmarcadas e exigem confirmação explícita antes de adicionar.
- 46 testes Node passaram (documentos, qualidade, cache, duplicidade, importação e fila). Quatro testes Python de agrupamento geométrico passaram.
- No Chrome isolado, passaram os fluxos de texto ilegível, resultado vazio, correção real pelo endpoint, colagem de JSON, cópia do pedido, seleção geral, confirmação e persistência de linhas com quantidade recebida zero. Sem erro JavaScript.
- Rascunho visual separado: 54 produtos visíveis, sem duplicar a primeira página; 30 linhas com dúvidas explícitas. O documento não foi aprovado e nenhum estoque comercial foi movimentado.

## Kits variáveis — 15/10/2026

- Composição por recebimento: rótulo livre, quantidade inteira por tipo, código de barras e produto individual por componente. Exemplos: P/M/G, 3 P, 4 G, Tam 1/2/3.
- Identificar componentes não conta mercadoria. `kit_count` registra kits completos em evento separado, com reenvio idempotente e estorno. Eventos antigos conservam seu hash de identificação.
- Aprovação multiplica kits recebidos pelas peças de cada tipo e movimenta apenas os SKUs individuais, com transação e histórico. Não duplica entrada no produto kit, não aplica outra conversão fracionada às peças e não altera preços, custos ou contas a pagar.
- 93 testes Node passaram: 32 de recebimentos, 31 da interface/importação/fila e regressões de documentos, OCR e coletor anterior. Os testes de estoque usaram exclusivamente MongoDB temporário.
- Cenários de estoque verificados: P/M/G, 3 P, 4 G, tamanhos numerados, aliases do mesmo SKU, produto presente em kit e linha comum, aprovação concorrente, repetição, estorno, catálogo alterado e rollback após a primeira movimentação.
- 17 verificações no Chrome isolado passaram: configurar, preservar custo 219,99, identificar sem contar, código conhecido/desconhecido, `2 × (3 P + 4 G) = 6 P + 8 G`, desfazer, revisão e conclusão em teste. Modal de 360 px sem transbordamento horizontal, sem erros JavaScript.
- 86 testes Android passaram, incluindo 11 novos testes de kits. Sete testes de telas Compose passaram: quatro de kits e três do espaço de recebimento; um teste auxiliar do renderizador também passou. Renderização nativa em 360×640 e 360×480, incluindo fonte ampliada.
- Android preserva o alvo do bipe na fila, bloqueia edição com leituras/estornos pendentes, rejeita salvar uma composição antiga após mudança remota e impede novas seleções/contagens do kit enquanto sua composição é salva. Fechar o kit não ativa contagem automaticamente.
- JSON e CSV preservam a composição. Composição alterada exige nova confirmação no site. Nenhum cadastro novo foi inventado e nenhum recebimento comercial foi aprovado nesta validação.
- Não havia TC57 conectado; instalação sobre a versão anterior e leitura com os gatilhos físicos continuam dependendo do teste no aparelho.
