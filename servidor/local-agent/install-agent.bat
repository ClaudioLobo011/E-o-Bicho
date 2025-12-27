@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js e tente novamente.
  pause
  exit /b 1
)

set TASK_NAME=EoBicho PDV Local Agent
schtasks /Create /F /SC ONLOGON /RL LIMITED /DELAY 0000:10 /TN "%TASK_NAME%" /TR "\"%~dp0start-agent.bat\" --hidden" >nul 2>&1

echo Agente instalado. Iniciando agora...
call "%~dp0start-agent.bat" --hidden
exit /b 0
