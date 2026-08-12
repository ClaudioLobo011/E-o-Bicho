[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$serverDirectory = Join-Path $repoRoot 'servidor'
$environmentFile = Join-Path $serverDirectory '.env'
$requiredEnvironmentKeys = @(
    'CERTIFICATE_SECRET_KEY',
    'GOOGLE_DRIVE_CLIENT_ID',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_FOLDER_ID',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
    'IFOOD_API_BASE',
    'IFOOD_ITEMS_PATH',
    'IFOOD_ITEMS_RESET',
    'IFOOD_OAUTH_PATH',
    'IFOOD_ORDER_ACK_PATH',
    'IFOOD_ORDER_BASE',
    'IFOOD_ORDER_DETAIL_PATH',
    'IFOOD_ORDER_POLL_PATH',
    'IFOOD_STATUS_PATH',
    'JWT_SECRET',
    'MONGO_URI',
    'R2_ACCESS_KEY_ID',
    'R2_ACCOUNT_ID',
    'R2_BUCKET',
    'R2_PUBLIC_BASE_URL',
    'R2_REGION',
    'R2_SECRET_ACCESS_KEY',
    'ZOHO_FROM_EMAIL',
    'ZOHO_FROM_NAME',
    'ZOHO_SMTP_HOST',
    'ZOHO_SMTP_PASS',
    'ZOHO_SMTP_PORT',
    'ZOHO_SMTP_SECURE',
    'ZOHO_SMTP_USER'
)

function Test-HttpEndpoint {
    param([string]$Name, [string]$Uri)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 12
        return [ordered]@{ name = $Name; uri = $Uri; ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400); status = $response.StatusCode }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        return [ordered]@{ name = $Name; uri = $Uri; ok = $false; status = $status; error = $_.Exception.Message }
    }
}

$presentKeys = @()
if (Test-Path -LiteralPath $environmentFile) {
    $presentKeys = Get-Content -LiteralPath $environmentFile |
        Where-Object { $_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=' } |
        ForEach-Object { [regex]::Match($_, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=').Groups[1].Value } |
        Sort-Object -Unique
}
$missingKeys = @($requiredEnvironmentKeys | Where-Object { $_ -notin $presentKeys })
$cloudflared = Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeVersion = try { (& node.exe --version) } catch { $null }
$cloudflaredVersion = try { (& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' --version) } catch { $null }

$checks = @(
    (Test-HttpEndpoint -Name 'local-liveness' -Uri "http://127.0.0.1:$Port/healthz"),
    (Test-HttpEndpoint -Name 'local-readiness' -Uri "http://127.0.0.1:$Port/readyz"),
    (Test-HttpEndpoint -Name 'callback-current' -Uri 'https://callback.peteobicho.com.br/'),
    (Test-HttpEndpoint -Name 'render-current' -Uri 'https://e-o-bicho.onrender.com/healthz'),
    (Test-HttpEndpoint -Name 'future-api' -Uri 'https://api.peteobicho.com.br/healthz')
)

[ordered]@{
    checkedAt = (Get-Date).ToString('o')
    repository = $repoRoot
    port = $Port
    portListening = [bool]$listener
    listenerProcessId = if ($listener) { $listener.OwningProcess } else { $null }
    nodeVersion = $nodeVersion
    cloudflaredVersion = $cloudflaredVersion
    cloudflaredService = if ($cloudflared) { [ordered]@{ status = [string]$cloudflared.Status; startType = [string]$cloudflared.StartType } } else { $null }
    environmentFilePresent = (Test-Path -LiteralPath $environmentFile)
    environmentKeyCount = $presentKeys.Count
    missingRequiredEnvironmentKeys = $missingKeys
    endpoints = $checks
} | ConvertTo-Json -Depth 6
