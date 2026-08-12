[CmdletBinding()]
param([string]$InstallRoot = 'C:\EoBichoServer')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
$paths = Get-InstallPaths -InstallRoot $InstallRoot
foreach ($required in @($paths.Node, $paths.Cloudflared, $paths.Token, (Join-Path $paths.Server '.env'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Instalacao incompleta: $required" }
}

Write-Host 'ATENCAO: a maquina antiga deve estar desligada ou com API e Cloudflared parados.' -ForegroundColor Yellow
Write-Host 'Isso evita dois servidores consultando pedidos e automacoes ao mesmo tempo.' -ForegroundColor Yellow
$confirmation = Read-Host 'Digite ATIVAR para continuar'
if ($confirmation -cne 'ATIVAR') { throw 'Ativacao cancelada.' }

$task = Get-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction Stop
Enable-ScheduledTask -TaskName $script:ApiTaskName | Out-Null
Start-ScheduledTask -TaskName $script:ApiTaskName
if (-not (Wait-HttpOk -Uri 'http://127.0.0.1:3000/readyz' -TimeoutSeconds 90)) {
    Stop-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue | Out-Null
    throw 'A API nao ficou pronta. O tunnel nao foi iniciado.'
}

$token = [IO.File]::ReadAllText($paths.Token).Trim()
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Token do tunnel ausente.' }
$service = Get-CimInstance Win32_Service -Filter "Name='$($script:TunnelServiceName)'" -ErrorAction SilentlyContinue
if ($service) {
    if ([string]$service.PathName -notlike "*$token*") {
        throw 'Ja existe outro servico Cloudflared nesta maquina. Nada foi sobrescrito.'
    }
    Set-Service -Name $script:TunnelServiceName -StartupType Automatic
    Start-Service -Name $script:TunnelServiceName
} else {
    $install = Start-Process -FilePath $paths.Cloudflared -ArgumentList @('service', 'install', $token) -Wait -PassThru -WindowStyle Hidden
    if ($install.ExitCode -ne 0) { throw "Falha ao instalar o tunnel. Codigo: $($install.ExitCode)" }
    Set-Service -Name $script:TunnelServiceName -StartupType Automatic
    Start-Service -Name $script:TunnelServiceName -ErrorAction SilentlyContinue
}
$token = $null

$serviceReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((Get-Service -Name $script:TunnelServiceName -ErrorAction SilentlyContinue).Status -eq 'Running') {
        $serviceReady = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $serviceReady) { throw 'O Cloudflared nao ficou ativo.' }

Write-Host ''
Write-Host 'SERVIDOR ATIVADO NESTA MAQUINA.' -ForegroundColor Green
Write-Host 'API local: pronta.'
Write-Host 'Tunnel Cloudflare: ativo e automatico.'
try {
    $public = Invoke-WebRequest -Uri 'https://api.peteobicho.com.br/healthz' -UseBasicParsing -TimeoutSec 15
    Write-Host "API publica: HTTP $($public.StatusCode)."
} catch {
    Write-Warning 'A rota publica api.peteobicho.com.br ainda nao respondeu. Verifique a rota do tunnel no Cloudflare.'
}

