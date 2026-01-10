PDV Local Agent (Windows)
=========================

Agente local para impressao direta em impressoras termicas (ESC/POS) sem abrir
janela de visualizacao. O agente recebe JSON estruturado e imprime via driver
local em fila (1 job por vez).

Requisitos
- Windows 10/11
- .NET Framework 4.8 instalado (padrao no Windows 10/11)

Instalacao rapida
1) Copie esta pasta para o computador do PDV.
2) (Opcional) Crie agent-config.json baseado no agent-config.example.json.
3) Execute install-agent.bat (cria tarefa e inicia em segundo plano).

Instalacao por setup.exe
1) Baixe o arquivo pdv-local-agent-setup.exe.
2) Execute (duplo clique). Ele instala/atualiza em %LOCALAPPDATA%\PdvLocalAgent.
3) O agente inicia automaticamente em segundo plano.

Execucao manual
- start-agent.bat (console visivel)
- start-agent.bat --hidden (segundo plano)
- build-agent.bat (compila o exe caso nao exista)

Logs
- agent.log (informacoes)
- agent.err (erros)

API
- GET /health -> { ok: true, version, queue }
- GET /printers -> { ok: true, printers: [...] }
- GET /queue -> { ok: true, jobs: [...] }
- GET /jobs/<id> -> { ok: true, job: {...} }
- POST /print-json -> { ok: true, queued: true, jobId }

Exemplo de payload /print-json
{
  "printerName": "MP-4200 TH",
  "copies": 1,
  "jobName": "Comprovante de venda",
  "document": {
    "version": 1,
    "type": "venda",
    "title": "Comprovante de venda",
    "paperWidth": "80mm",
    "logo": { "enabled": false, "label": "Em desenvolvimento" },
    "meta": { "store": "Pet Shop", "pdv": "01", "saleCode": "123", "operator": "Caixa", "date": "01/01/2025 10:30" },
    "items": [
      { "index": "01", "name": "Racao", "code": "789", "quantity": "1", "unitPrice": "R$ 10,00", "total": "R$ 10,00" }
    ],
    "totals": { "subtotal": "R$ 10,00", "total": "R$ 10,00", "paid": "R$ 10,00", "change": "R$ 0,00" },
    "payments": [ { "label": "Dinheiro", "value": "R$ 10,00" } ]
  }
}

Config (agent-config.json)
- host, port: endereco e porta de escuta
- printWaitMs: timeout por job (ms, minimo 2000, maximo 120000)
- queueMax: maximo de jobs enfileirados
- maxCopies: limite de vias por job
- maxBodyBytes: limite de payload
- paperWidth: "80mm" ou "58mm"
- codePage: cp860 (padrao), cp850, cp1252, cp437
- defaultPrinter: nome da impressora padrao (opcional)
- printerAliases: alias -> nome real da impressora

Desinstalar
- uninstall-agent.bat
- uninstall-agent.bat --clean (remove logs)

Troubleshooting
- Se aparecer print-timeout, aumente printWaitMs.
- Confirme o nome da impressora em GET /printers.
- Para acentos incorretos, ajuste codePage (ex: cp850 ou cp1252).
