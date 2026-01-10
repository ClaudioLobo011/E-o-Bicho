@echo off
setlocal
cd /d "%~dp0"

set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo .NET Framework 4.8 nao encontrado. Instale o .NET Framework 4.8 e tente novamente.
  exit /b 1
)

set "PACKAGE_ZIP=%~dp0..\..\public\downloads\pdv-local-agent.zip"
if not exist "%PACKAGE_ZIP%" (
  echo Pacote pdv-local-agent.zip nao encontrado. Gere o zip antes de compilar o setup.
  exit /b 1
)

"%CSC%" /nologo /target:winexe /optimize ^
  /out:"%~dp0pdv-local-agent-setup.exe" ^
  /r:System.IO.Compression.FileSystem.dll ^
  /r:System.Windows.Forms.dll ^
  /resource:"%PACKAGE_ZIP%",pdv-local-agent.zip ^
  "%~dp0pdv-local-agent-setup.cs"
if errorlevel 1 exit /b 1
echo Build concluido.
