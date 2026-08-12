$script:DefaultInstallRoot = 'C:\EoBichoServer'
$script:ApiTaskName = 'EoBicho-API'
$script:TunnelServiceName = 'Cloudflared'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Esta operacao precisa ser executada como Administrador.'
    }
}

function Wait-HttpOk {
    param(
        [Parameter(Mandatory)] [string]$Uri,
        [int]$TimeoutSeconds = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-InstallPaths {
    param([string]$InstallRoot = $script:DefaultInstallRoot)
    [pscustomobject]@{
        Root = $InstallRoot
        Server = Join-Path $InstallRoot 'app\servidor'
        Node = Join-Path $InstallRoot 'runtime\node\node.exe'
        Cloudflared = Join-Path $InstallRoot 'runtime\cloudflared\cloudflared.exe'
        Token = Join-Path $InstallRoot 'config\cloudflared.token'
        Runner = Join-Path $InstallRoot 'tools\Run-InstalledApi.ps1'
        Logs = Join-Path $InstallRoot 'logs'
    }
}

function Test-PortAvailable {
    param([int]$Port)
    return -not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

