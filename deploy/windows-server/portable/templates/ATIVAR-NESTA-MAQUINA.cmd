@echo off
chcp 65001 >nul
fltmc >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title E o Bicho - Ativar servidor
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "C:\EoBichoServer\tools\Activate-PortableServer.ps1"
echo.
pause

