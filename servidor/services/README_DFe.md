# Distribuição DF-e (NFeDistribuicaoDFe)

Este módulo integra com o serviço **NFeDistribuicaoDFe** da SEFAZ utilizando SOAP 1.2 por padrão, com fallback opcional para SOAP 1.1.

## Configuração necessária

Defina as seguintes variáveis de ambiente:

- `NFE_AN_DFE_URL` – URL de produção (`https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`).
- `NFE_AN_DFE_HOMOLOG_URL` – URL de homologação (`https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`).
- `NFE_PFX_PATH` – caminho absoluto ou relativo do certificado A1 (arquivo PFX).
- `NFE_PFX_PASSWORD` – senha do PFX.
- `NFE_EMPRESA_UF` – código numérico (dois dígitos) da UF autora (ex.: `33`).
- `NFE_EMPRESA_CNPJ` – CNPJ da empresa utilizado pelo script de diagnóstico.
- `NFE_DFE_SOAP_VERSION` – `12` (padrão) ou `11` para forçar SOAP 1.1.
- `NFE_DFE_DEBUG` – defina `1` para habilitar logs adicionais de debug.

> A cadeia completa do certificado A1 (intermediários) deve estar instalada no host do Node.js. Falhas de confiança parcial resultam em erros TLS ou SOAP Faults.

## Execução do coletor

A função `collectDistributedDocuments` cuida de:

- Persistir e avançar o `ultNSU` por CNPJ + ambiente.
- Montar `nfeDadosMsg` corretamente e alternar entre `distNSU`, `consNSU` e `consChNFe`.
- Aplicar fallback automático para SOAP 1.1 apenas quando necessário.

### Modos suportados

- `distNSU` (padrão): varredura incremental usando `ultNSU` conhecido.
- `consNSU`: consulta de um NSU específico (requer `nsu`).
- `consChNFe`: consulta direta por chave de acesso (requer `chave`).

## Script de diagnóstico

Use o CLI para isolar problemas de comunicação:

```bash
node scripts/test-dfe.js --mode=distNSU --tpAmb=1 --uf=33 --cnpj=07919703000167 \
  --nsu=0 --pfx=./certificados/empresa.pfx --pwd=senhaSegura
```

Outros exemplos:

```bash
# Consulta por NSU específico via SOAP 1.1
env NFE_DFE_SOAP_VERSION=11 node scripts/test-dfe.js \
  --mode=consNSU --nsu=000000000000123 --tpAmb=1 --uf=33 --cnpj=07919703000167

# Consulta por chave de acesso específica
node scripts/test-dfe.js --mode=consChNFe --chave=35191111111111111111550010000012345678901234 \
  --tpAmb=1 --uf=33 --cnpj=07919703000167
```

A saída apresenta status HTTP, content-type recebido, prévia do corpo (até 400 caracteres) e os campos `cStat`, `xMotivo`, `ultNSU` e `maxNSU` extraídos.

## Observabilidade

Os logs produzidos durante a coleta incluem:

- Versão SOAP utilizada e Content-Type enviado.
- Primeira linha da resposta e Content-Type recebido.
- `cStat` e `xMotivo` retornados em chamadas com sucesso.

Dados sensíveis (como CNPJ/NSU completos) são mascarados automaticamente nos logs.
