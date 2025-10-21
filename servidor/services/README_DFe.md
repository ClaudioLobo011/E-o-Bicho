# Integração DF-e (Distribuição de Documentos Fiscais Eletrônicos)

Este serviço realiza consultas ao `NFeDistribuicaoDFe` para coletar DF-e por **NSU** ou por **chave** diretamente na SEFAZ.

## Variáveis de ambiente relevantes

| Variável | Descrição |
| --- | --- |
| `SEFAZ_DFE_ENVIRONMENT` | Define o ambiente padrão (`producao` ou `homologacao`). |
| `SEFAZ_DFE_NATIONAL_AUTHOR_UF` | UF utilizada como fallback quando a UF da empresa é inválida (padrão `33`). |
| `NFE_AN_DFE_URL` / `NFE_AN_DFE_URL_PROD` | Endpoint de produção para o serviço ASMX. |
| `NFE_AN_DFE_HOMOLOG_URL` / `NFE_AN_DFE_URL_HOMOLOG` | Endpoint de homologação (quando necessário). |
| `NFE_DFE_SOAP_VERSION` | Força versão SOAP (`12` para 1.2, `11` para 1.1). Quando `12`, o código aplica downgrade automático para 1.1 em respostas `soap:Fault` com `NullReference`. |
| `NFE_DFE_DEBUG` | Quando igual a `1`, habilita logs verbosos internos do coletor. |
| `NFE_PFX_PATH` e `NFE_PFX_PASSWORD` | Utilizados pelo script de diagnóstico para carregar o certificado A1. |

## Persistência de NSU

* O último NSU obtido é persistido por **CNPJ + ambiente** usando a coleção `Setting` (chave `dfe:last-nsu:<ambiente>:<cnpj>`).
* Caso o MongoDB não esteja conectado, o sistema registra aviso e utiliza cache em memória como fallback.
* Para reiniciar a busca do zero, remova a entrada correspondente na coleção ou ajuste manualmente o campo `ultNSU`.

## Fallback automático SOAP 1.2 → 1.1

1. O coletor envia consultas usando SOAP 1.2 com `Content-Type: application/soap+xml; charset=utf-8; action="..."`.
2. Se a SEFAZ responder com `soap:Fault`/HTTP 500 contendo `Object reference not set to an instance of an object`, ocorre downgrade transparente para SOAP 1.1 (`Content-Type: text/xml; charset=utf-8` + `SOAPAction`).
3. O downgrade é logado via `console.warn` e pode ser desabilitado definindo `NFE_DFE_SOAP_VERSION=11`.

## Script de diagnóstico

```
node scripts/test-dfe.js --cnpj=07919703000167 --uf=RJ --mode=consNSU --ultnsu=000000000000000
```

Argumentos opcionais:

* `--ambiente=producao|homologacao`
* `--chave=<44 dígitos>` (obrigatório quando `--mode=consChNFe`)
* `--endpoint=<URL>` (para testar endpoints alternativos)

Pré-requisitos do script:

* `NFE_PFX_PATH` com o caminho do PFX (A1) e `NFE_PFX_PASSWORD` com a senha.
* Opcional: `NFE_DFE_SOAP_VERSION` para forçar a versão do SOAP.

Saída esperada:

* HTTP status e `Content-Type` retornados pela SEFAZ.
* Prévia de 400 caracteres do corpo SOAP recebido.
* `cStat`, `xMotivo`, `ultNSU`, `maxNSU` e quantidade de documentos processados.

## Sintomas comuns

| Sintoma | Possível causa | Ação sugerida |
| --- | --- | --- |
| `soap:Fault` com `NullReference` | Falta do atributo `action` no `Content-Type` ou envio via SOAP 1.1 para endpoint que exige SOAP 1.2 | Verifique headers; o coletor já faz downgrade automático caso a SEFAZ responda com essa falha. |
| `cStat 656` / `573` | Certificado inválido ou cadeia incompleta | Instale certificados intermediários e confirme que o PFX contém chave privada e cadeia completa. |
| Nenhum documento retornado | `ultNSU` persistido muito alto | Apague o registro `dfe:last-nsu:<ambiente>:<cnpj>` em `Setting` para reiniciar a consulta. |

