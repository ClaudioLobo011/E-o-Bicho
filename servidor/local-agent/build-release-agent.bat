@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "AGENT_DIR=%~dp0"
for %%I in ("%~dp0..\..") do set "ROOT_DIR=%%~fI"
set "PUBLIC_DOWNLOADS=%ROOT_DIR%\public\downloads"
set "PACKAGE_ZIP=%PUBLIC_DOWNLOADS%\pdv-local-agent.zip"
set "PUBLIC_SETUP=%PUBLIC_DOWNLOADS%\pdv-local-agent-setup.exe"
set "LOCAL_SETUP=%AGENT_DIR%pdv-local-agent-setup.exe"

echo [1/4] Compilando agente...
call "%AGENT_DIR%build-agent.bat"
if errorlevel 1 exit /b 1

if not exist "%PUBLIC_DOWNLOADS%" (
  echo Pasta de downloads nao encontrada: "%PUBLIC_DOWNLOADS%"
  exit /b 1
)

echo [2/4] Gerando pacote ZIP para update...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Compress-Archive -Force -DestinationPath '%PACKAGE_ZIP%' -Path @('%AGENT_DIR%agent-config.example.json','%AGENT_DIR%pdv-local-agent.exe','%AGENT_DIR%pdv-local-agent.cs','%AGENT_DIR%README.txt','%AGENT_DIR%start-agent.bat','%AGENT_DIR%install-agent.bat','%AGENT_DIR%uninstall-agent.bat','%AGENT_DIR%build-agent.bat')"
if errorlevel 1 exit /b 1

echo [3/4] Compilando instalador setup.exe...
call "%AGENT_DIR%build-setup.bat"
if errorlevel 1 exit /b 1

if not exist "%LOCAL_SETUP%" (
  echo Setup nao foi gerado: "%LOCAL_SETUP%"
  exit /b 1
)

echo [4/4] Copiando setup para public/downloads...
copy /Y "%LOCAL_SETUP%" "%PUBLIC_SETUP%" >nul
if errorlevel 1 exit /b 1

echo.
echo Release do agente concluida.
echo Arquivos atualizados:
echo - "%PACKAGE_ZIP%"
echo - "%PUBLIC_SETUP%"
echo - "%AGENT_DIR%pdv-local-agent.exe"
echo.
echo Proximo passo: publicar/deploy da pasta public/downloads.
exit /b 0
