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
