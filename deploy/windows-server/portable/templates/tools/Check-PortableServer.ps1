[CmdletBinding()]
param([string]$InstallRoot = 'C:\EoBichoServer')

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'Common.ps1')
$paths = Get-InstallPaths -InstallRoot $InstallRoot
$task = Get-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue
$service = Get-Service -Name $script:TunnelServiceName -ErrorAction SilentlyContinue
$localHealth = $false
$localReady = $false
$publicHealth = $false
try { $localHealth = (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/healthz' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
try { $localReady = (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/readyz' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
try { $publicHealth = (Invoke-WebRequest -Uri 'https://api.peteobicho.com.br/healthz' -UseBasicParsing -TimeoutSec 15).StatusCode -eq 200 } catch {}

[pscustomobject]@{
    Instalado = Test-Path -LiteralPath $paths.Server -PathType Container
    TarefaAPI = if ($task) { [string]$task.State } else { 'Ausente' }
    Cloudflare = if ($service) { [string]$service.Status } else { 'Ausente' }
    HealthLocal = $localHealth
    BancoPronto = $localReady
    HealthPublico = $publicHealth
    Pasta = $InstallRoot
} | Format-List

if ($localReady -and $service -and $service.Status -eq 'Running') {
    Write-Host 'Servidor local pronto.' -ForegroundColor Green
} elseif (Test-Path -LiteralPath $paths.Server) {
    Write-Host 'Pacote instalado, mas ainda nao ativado ou com alguma verificacao pendente.' -ForegroundColor Yellow
} else {
    Write-Host 'Pacote ainda nao instalado.' -ForegroundColor Yellow
}

