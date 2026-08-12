[CmdletBinding()]
param([string]$InstallRoot = 'C:\EoBichoServer')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
$paths = Get-InstallPaths -InstallRoot $InstallRoot

$task = Get-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $script:ApiTaskName -ErrorAction SilentlyContinue | Out-Null
}

$service = Get-CimInstance Win32_Service -Filter "Name='$($script:TunnelServiceName)'" -ErrorAction SilentlyContinue
if ($service) {
    $owned = [string]$service.PathName -like "*$InstallRoot*"
    if (-not $owned -and (Test-Path -LiteralPath $paths.Token -PathType Leaf)) {
        $token = [IO.File]::ReadAllText($paths.Token).Trim()
        $owned = -not [string]::IsNullOrWhiteSpace($token) -and [string]$service.PathName -like "*$token*"
        $token = $null
    }
    if (-not $owned) { throw 'O servico Cloudflared existente nao pertence a este pacote e foi preservado.' }
    Stop-Service -Name $script:TunnelServiceName -Force -ErrorAction SilentlyContinue
    Set-Service -Name $script:TunnelServiceName -StartupType Manual
}

Write-Host 'Servidor E o Bicho desativado nesta maquina.' -ForegroundColor Green
Write-Host 'Os arquivos e configuracoes foram preservados.'

