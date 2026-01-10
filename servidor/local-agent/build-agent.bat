@echo off
setlocal
cd /d "%~dp0"

set "CSC=%WINDIR%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
if not exist "%CSC%" (
  echo .NET Framework 4.8 nao encontrado. Instale o .NET Framework 4.8 e tente novamente.
  exit /b 1
)

"%CSC%" /nologo /target:exe /optimize /out:"%~dp0pdv-local-agent.exe" /r:System.Web.Extensions.dll "%~dp0pdv-local-agent.cs"
if errorlevel 1 exit /b 1
echo Build concluido.
