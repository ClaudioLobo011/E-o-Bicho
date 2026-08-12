@echo off
chcp 65001 >nul
title E o Bicho - Verificar servidor
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "C:\EoBichoServer\tools\Check-PortableServer.ps1"
echo.
pause

