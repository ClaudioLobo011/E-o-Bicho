[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,

    [ValidateRange(1, 300)]
    [int]$RestartDelaySeconds = 5,

    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$serverDirectory = Join-Path $repoRoot 'servidor'
$serverEntry = Join-Path $serverDirectory 'server.js'
$environmentFile = Join-Path $serverDirectory '.env'
$nodeCommand = Get-Command node.exe -ErrorAction Stop

if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
    throw "Entrada da API nao encontrada: $serverEntry"
}
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw "Arquivo de ambiente ausente: $environmentFile"
}

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($existingListener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($existingListener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($owner -and $owner.Name -eq 'node.exe' -and $owner.CommandLine -match 'server\.js') {
        Write-Output "A API ja esta escutando na porta $Port (PID $($owner.ProcessId))."
        exit 0
    }
    throw "A porta $Port esta ocupada por outro processo. Nada foi iniciado."
}

$logRoot = Join-Path $env:ProgramData 'EoBichoServer\logs'
try {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
} catch {
    $logRoot = Join-Path $env:LOCALAPPDATA 'EoBichoServer\logs'
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
}

$env:NODE_ENV = 'production'
$env:PORT = [string]$Port

Push-Location -LiteralPath $serverDirectory
try {
    do {
        $logFile = Join-Path $logRoot ("api-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
        "[$(Get-Date -Format o)] Iniciando API na porta $Port." | Add-Content -LiteralPath $logFile
        & $nodeCommand.Source $serverEntry *>> $logFile
        $exitCode = $LASTEXITCODE
        "[$(Get-Date -Format o)] API encerrou com codigo $exitCode." | Add-Content -LiteralPath $logFile

        if (-not $Once) {
            Start-Sleep -Seconds $RestartDelaySeconds
        }
    } while (-not $Once)
} finally {
    Pop-Location
}

exit $exitCode
