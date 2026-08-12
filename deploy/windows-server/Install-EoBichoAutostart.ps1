[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,

    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Execute este instalador em PowerShell como Administrador.'
}

$taskName = 'EoBicho-API'
$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Run-EoBichoApi.ps1')).Path
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Port $Port"

$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

if ($PSCmdlet.ShouldProcess($taskName, 'Registrar inicializacao automatica da API')) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $taskPrincipal `
        -Settings $settings `
        -Description 'Mantem a API Node/Express do E o Bicho ativa na porta local 3000.' `
        -Force | Out-Null

    Write-Output "Tarefa $taskName registrada."
}

$cloudflared = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Write-Warning 'O servico Cloudflared nao foi encontrado. O tunnel precisa ser instalado antes da virada.'
} elseif ($cloudflared.StartType -ne 'Automatic') {
    Write-Warning 'O servico Cloudflared existe, mas nao esta configurado como Automatico.'
} else {
    Write-Output "Cloudflared preservado: $($cloudflared.Status), inicializacao Automatico."
}

if ($StartNow -and $PSCmdlet.ShouldProcess($taskName, 'Iniciar API agora')) {
    Start-ScheduledTask -TaskName $taskName
    Write-Output 'Solicitacao de inicio enviada. Use Check-EoBichoMigration.ps1 para validar.'
}
