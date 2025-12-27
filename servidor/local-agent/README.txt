PDV Local Agent (Windows)
=========================

This agent runs on the PDV machine and receives print jobs from the browser.
It prints receipts to a specific printer name without opening the print dialog.
The /print endpoint responds immediately and prints in background (queue, 1 job at a time).

Requirements
- Windows 10/11
- Node.js 18+ installed
- Microsoft Edge installed (used to print HTML in kiosk mode)

Quick start
1) Copy this folder to the PDV machine.
2) Run install-agent.bat to create a startup task (hidden).
3) The agent will listen on http://127.0.0.1:17305

Manual start
- Run start-agent.bat (visible console)
- Run start-agent.bat --hidden (background)

Logs (hidden mode)
- agent.log
- agent.err

API
- GET /health -> { ok: true, version }
- GET /printers -> { ok: true, printers: [...] }
- GET /queue -> { ok: true, queued: <number>, active: {...}|null }
- GET /jobs/<id> -> { ok: true, job: {...} }
- POST /print -> { ok: true, queued: true, jobId }
  Payload:
  {
    "html": "<html>...</html>",
    "printerName": "MP-4200 TH",
    "copies": 1,
    "jobName": "Comprovante de venda"
  }

Uninstall
- Run uninstall-agent.bat
- Run uninstall-agent.bat --clean to remove edge-profile and logs

Config
- Optional: create agent-config.json based on agent-config.example.json
- host, port: where the agent listens
- edgePath: custom path to msedge.exe (optional)
- edgeProfileDir: persistent Edge profile directory (default ./edge-profile)
- printWaitMs: time to wait for each print job (ms)
- queueMax: maximum queued jobs before rejecting new ones
- maxCopies: maximum allowed copies per job
- maxBodyBytes: max request size in bytes
- printerAliases: map a shared alias to the local printer name

Troubleshooting
- If you see print-timeout in agent.err, increase printWaitMs and verify Edge is not stuck open.
- If Edge is left open, close it and retry. The agent will kill Edge on timeout.
- Verify printers with GET /printers and use the exact name.
- If hidden mode does not print, reinstall so the task runs interactively (Run only when user is logged on).
