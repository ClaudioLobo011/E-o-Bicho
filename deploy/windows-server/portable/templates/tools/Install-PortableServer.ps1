[CmdletBinding()]
param([string]$InstallRoot = 'C:\EoBichoServer')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator

$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceApp = Join-Path $packageRoot 'app'
$sourceRuntime = Join-Path $packageRoot 'runtime'
$sourceConfig = Join-Path $packageRoot 'config'
foreach ($required in @(
    (Join-Path $sourceApp 'servidor\server.js'),
    (Join-Path $sourceRuntime 'node\node.exe'),
    (Join-Path $sourceRuntime 'cloudflared\cloudflared.exe'),
    (Join-Path $sourceConfig 'server.env'),
    (Join-Path $sourceConfig 'cloudflared.token')
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Pacote incompleto: $required" }
}

$destinationParent = Split-Path -Parent $InstallRoot
New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
$resolvedParent = (Resolve-Path -LiteralPath $destinationParent).Path
$destinationLeaf = Split-Path -Leaf $InstallRoot
$resolvedDestination = Join-Path $resolvedParent $destinationLeaf
if (-not $resolvedDestination.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Destino de instalacao invalido.'
}

if (Test-Path -LiteralPath $resolvedDestination) {
    $existingTask = Get-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue
    if ($existingTask -and $existingTask.State -eq 'Running') {
        throw 'Ja existe uma API ativa nesta maquina. Desative-a antes de reinstalar.'
    }
}
New-Item -ItemType Directory -Path $resolvedDestination -Force | Out-Null

foreach ($folder in @('app', 'runtime', 'tools')) {
    $source = Join-Path $packageRoot $folder
    $destination = Join-Path $resolvedDestination $folder
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    & robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar $folder. Codigo robocopy: $LASTEXITCODE" }
}

$installedConfig = Join-Path $resolvedDestination 'config'
New-Item -ItemType Directory -Path $installedConfig -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceConfig 'server.env') -Destination (Join-Path $resolvedDestination 'app\servidor\.env') -Force
Copy-Item -LiteralPath (Join-Path $sourceConfig 'cloudflared.token') -Destination (Join-Path $installedConfig 'cloudflared.token') -Force
Copy-Item -LiteralPath (Join-Path $packageRoot 'pacote-manifesto.json') -Destination (Join-Path $resolvedDestination 'pacote-manifesto.json') -Force

$paths = Get-InstallPaths -InstallRoot $resolvedDestination
$testPort = 3100
if (-not (Test-PortAvailable -Port $testPort)) { throw "A porta de teste $testPort esta ocupada." }
New-Item -ItemType Directory -Path $paths.Logs -Force | Out-Null
$stdout = Join-Path $paths.Logs 'teste-instalacao.log'
$stderr = Join-Path $paths.Logs 'teste-instalacao-erro.log'
$env:NODE_ENV = 'production'
$env:PORT = [string]$testPort
$env:DISABLE_EXTERNAL_WORKERS = 'true'
$env:SKIP_MAIL_VERIFY = 'true'
$testProcess = Start-Process -FilePath $paths.Node -ArgumentList 'server.js' -WorkingDirectory $paths.Server -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
    if (-not (Wait-HttpOk -Uri "http://127.0.0.1:$testPort/readyz" -TimeoutSeconds 90)) {
        throw 'A API nao ficou pronta no teste local. Consulte a pasta logs.'
    }
} finally {
    if ($testProcess -and -not $testProcess.HasExited) {
        Stop-Process -Id $testProcess.Id -Force -ErrorAction SilentlyContinue
        $testProcess.WaitForExit(10000) | Out-Null
    }
    Remove-Item Env:DISABLE_EXTERNAL_WORKERS -ErrorAction SilentlyContinue
    Remove-Item Env:SKIP_MAIL_VERIFY -ErrorAction SilentlyContinue
}

$powershellExe = Join-Path $PSHOME 'powershell.exe'
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($paths.Runner)`" -Port 3000"
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $script:ApiTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'API do E o Bicho no servidor Windows.' -Force | Out-Null
Disable-ScheduledTask -TaskName $script:ApiTaskName | Out-Null

Write-Host ''
Write-Host 'INSTALACAO E TESTE CONCLUIDOS.' -ForegroundColor Green
Write-Host "A API foi copiada para $resolvedDestination e conectou ao banco no modo seguro."
Write-Host 'Nada foi publicado na internet e os processos automaticos ficaram desligados.'
Write-Host 'Para assumir a operacao, desligue o servidor antigo e abra ATIVAR-NESTA-MAQUINA.cmd.'

