# Configuração revisada de NFS-e

O comando é uma simulação por padrão e não emite documentos. O plano de pesquisa dos 34 serviços continua bloqueado até receber uma seção `execution` baseada em leitura atual do banco. `cacheUpdatedAt` não substitui essa leitura.

```powershell
node servidor/scripts/configure-nfse-services.js --plan plano-revisado.json --output-review revisao.json
node servidor/scripts/configure-nfse-services.js --plan plano-revisado.json --output-review resultado.json --apply
```

Antes de `--apply`, revisar o relatório concreto da simulação. O mesmo plano pode ser reaplicado: valores já configurados não são gravados novamente. Qualquer mudança necessária exige identidade, versão e valores anteriores compatíveis. O comando não habilita produção; a configuração resultante deve continuar em homologação.

O JSON mantém `services` da pesquisa e acrescenta:

```json
{
  "execution": {
    "catalogSource": "current-database",
    "reviewedAt": "timestamp ISO da leitura atual, há menos de 24 horas",
    "validUntil": "timestamp ISO, sem ultrapassar a vigência dos tributos",
    "expectedCompany": {
      "id": "ID exato da empresa emitente",
      "cnpj": "CNPJ conferido na leitura atual",
      "updatedAt": "updatedAt atual do documento",
      "nfse": {}
    },
    "storeNfsePatch": {},
    "rules": [
      {
        "code": 701,
        "name": "Nome exato revisado",
        "classificationResolved": true,
        "taxesResolved": true,
        "expected": { "exists": false },
        "fiscal": { "nfse": {} }
      }
    ]
  },
  "services": [
    {
      "serviceId": "ID existente conferido",
      "name": "Nome atual exato",
      "readyToApply": true,
      "classificationResolved": true,
      "taxesResolved": true,
      "fiscalRuleCode": "701",
      "descricao": "",
      "expected": {
        "updatedAt": "updatedAt atual do serviço",
        "fiscalForCompany": null
      }
    }
  ]
}
```

Os objetos vazios acima são marcadores, não configurações prontas. `expectedCompany.nfse` e `expected.fiscalForCompany` devem reproduzir os valores atuais; `null` significa vínculo inexistente. Para uma regra existente, `expected` exige `exists:true`, `updatedAt`, `name`, `tipo:"servico"` e `nfse` anteriores. O código é explícito e nunca é escolhido automaticamente; códigos ocupados por produtos são recusados.

`fiscal.nfse` usa os campos de `utils/nfseConfig.js`, incluindo classificação nacional/municipal, NBS, ISS, município, modo/percentuais dos tributos, IBS/CBS e `tributosFonte`, `tributosVersao`, `tributosCodigoReferencia`, `tributosVigenciaInicio`, `tributosVigenciaFim`. A classificação e os tributos devem estar resolvidos para cada regra e serviço selecionado. Serviços com `readyToApply:false` aparecem como bloqueados e não são alterados.

Quando o município calcula o ISS e exige omissão de `pAliq`, use `aliquotaIss:null` com `rule.issRateResolvedByMunicipality:{confirmed:true,rate:5,source:"URL HTTPS da evidência oficial"}`. O configurador só admite essa justificativa para `opSimpNac:"1"`, ISS tributável e sem retenção. O percentual de referência fica no plano de revisão; não é copiado para a alíquota omitida da DPS.

A gravação usa transação MongoDB, exige o índice único `empresa/code` existente e grava backup fiscal antes de alterar dados. O backup contém somente identidade pública e os campos fiscais afetados; não inclui certificados, senhas ou dados de clientes. Preserva preços, grupos, demais empresas, configurações de NFC-e e emitente dos PDVs. Falhas revertem a transação. O relatório final identifica alterações, serviços bloqueados e o caminho do backup.

Teste isolado, sem usar `servidor/.env` nem banco real:

```powershell
node --test servidor/services/__tests__/nfseConfigurationApply.test.js
```
