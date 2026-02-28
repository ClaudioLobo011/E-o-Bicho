# Checklist de Homologacao - PDV em Concorrencia (2 Operadores)

## Objetivo
Validar o uso simultaneo do mesmo PDV/caixa em dois computadores sem:
- duplicar codigo de venda;
- duplicar codigo de orcamento;
- duplicar codigo de cliente por reenvio;
- perder atualizacao por sobrescrita silenciosa;
- precisar de F5 para ver mudancas no outro terminal.

## Pre-requisitos
1. Dois navegadores/logins ativos (Operador A e Operador B).
2. Mesmo `Empresa` e mesmo `PDV` selecionados.
3. Caixa aberto.
4. API e Socket.IO em execucao.

## Cenarios

### 1. Sincronizacao em tempo real
1. No Operador A, registrar uma `entrada` no caixa.
2. Confirmar que no Operador B a alteracao aparece sem F5.
3. Repetir com `saida`.
4. Repetir com inclusao e remocao de item em venda.

Resultado esperado:
- Dados refletem no outro operador em poucos segundos.
- Sem reload manual.

### 2. Venda simultanea e sequencia de codigo
1. Operador A monta venda e finaliza.
2. Operador B, quase ao mesmo tempo, finaliza outra venda.
3. Conferir lista de vendas no PDV.

Resultado esperado:
- Nenhum codigo de venda duplicado.
- Sequencia de codigo monotonicamente crescente no PDV.
- Nenhuma venda perdida apos sincronizacao.

### 3. Orcamento simultaneo
1. Operador A salva orcamento.
2. Operador B salva outro orcamento no mesmo intervalo.
3. Conferir lista de orcamentos.

Resultado esperado:
- Nenhum codigo de orcamento duplicado.
- Ambos os orcamentos persistidos.

### 4. Conflito otimista (expectedUpdatedAt)
1. Deixar Operador B parado em estado antigo.
2. Operador A faz alteracoes e persiste.
3. Operador B tenta persistir estado antigo.

Resultado esperado:
- Backend retorna conflito (409) para estado defasado.
- Front do Operador B sincroniza com estado atual e notifica.
- Sem sobrescrever silenciosamente as alteracoes do Operador A.

### 5. Idempotencia no estado do PDV
1. Forcar acao que dispare duas persistencias iguais (rede lenta/retry).
2. Conferir historico/vendas/orcamentos apos processar.

Resultado esperado:
- Requisicoes repetidas com a mesma chave idempotente nao duplicam efeito.

### 6. Cadastro de cliente com idempotencia
1. Disparar `POST /api/func/clientes` duas vezes com mesma `X-Idempotency-Key`.
2. Conferir retorno e base.

Resultado esperado:
- Mesma resposta para reenvio.
- Apenas um cliente criado.
- Sem codigoCliente duplicado.

### 7. Fechamento de caixa
1. Operador A fecha caixa.
2. Operador B tenta operar venda sem atualizar manualmente.

Resultado esperado:
- Estado de caixa fechado sincroniza sem F5.
- Operacoes bloqueadas/validadas conforme regra de caixa fechado.

## Evidencias a coletar
1. Capturas da lista de vendas com codigos distintos.
2. Capturas da lista de orcamentos com codigos distintos.
3. Log/rede mostrando conflito 409 e sincronizacao.
4. Log/rede mostrando replay idempotente do cadastro de cliente.

## Criterios de aprovacao
1. Nenhum codigo duplicado em vendas e orcamentos.
2. Nenhuma perda de registro por concorrencia.
3. Sincronizacao entre operadores sem F5.
4. Reenvio de request nao gera duplicidade.
