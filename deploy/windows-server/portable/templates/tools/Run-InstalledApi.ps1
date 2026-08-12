[CmdletBinding()]
param(
    [ValidateRange(1, 65535)] [int]$Port = 3000,
    [ValidateRange(1, 300)] [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$paths = Get-InstallPaths
$entry = Join-Path $paths.Server 'server.js'
$environmentFile = Join-Path $paths.Server '.env'
New-Item -ItemType Directory -Path $paths.Logs -Force | Out-Null

if (-not (Test-Path -LiteralPath $paths.Node -PathType Leaf)) { throw 'Node portatil ausente.' }
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'API ausente.' }
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw 'Configuracao da API ausente.' }

$existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.OwningProcess)" -ErrorAction SilentlyContinue
    if ($owner -and $owner.Name -eq 'node.exe' -and $owner.CommandLine -match 'server\.js') { exit 0 }
    throw "A porta $Port esta ocupada por outro programa."
}

$env:NODE_ENV = 'production'
$env:PORT = [string]$Port
Remove-Item Env:DISABLE_EXTERNAL_WORKERS -ErrorAction SilentlyContinue
Push-Location -LiteralPath $paths.Server
try {
    while ($true) {
        $log = Join-Path $paths.Logs ("api-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
        "[$(Get-Date -Format o)] Iniciando API." | Add-Content -LiteralPath $log
        & $paths.Node $entry *>> $log
        "[$(Get-Date -Format o)] API encerrou com codigo $LASTEXITCODE." | Add-Content -LiteralPath $log
        Start-Sleep -Seconds $RestartDelaySeconds
    }
} finally {
    Pop-Location
}

