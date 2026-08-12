[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

if (-not $OutputDirectory) {
    throw 'Informe OutputDirectory para uma pasta vazia ou inexistente.'
}

$repositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$serverSource = Join-Path $repositoryRoot 'servidor'
$environmentSource = Join-Path $serverSource '.env'
$templateSource = Join-Path $PSScriptRoot 'templates'
$outputParent = Split-Path -Parent $OutputDirectory
$outputLeaf = Split-Path -Leaf $OutputDirectory

if (-not (Test-Path -LiteralPath $environmentSource -PathType Leaf)) {
    throw 'O .env local da API nao foi encontrado.'
}
if (-not (Test-Path -LiteralPath $templateSource -PathType Container)) {
    throw 'Os modelos do pacote portatil nao foram encontrados.'
}

New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
$resolvedParent = (Resolve-Path -LiteralPath $outputParent).Path
$resolvedOutput = Join-Path $resolvedParent $outputLeaf
if (-not $resolvedOutput.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Destino do pacote invalido.'
}
if (Test-Path -LiteralPath $resolvedOutput) {
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

$appDestination = Join-Path $resolvedOutput 'app\servidor'
$runtimeNode = Join-Path $resolvedOutput 'runtime\node'
$runtimeCloudflared = Join-Path $resolvedOutput 'runtime\cloudflared'
$configDestination = Join-Path $resolvedOutput 'config'
New-Item -ItemType Directory -Path $appDestination, $runtimeNode, $runtimeCloudflared, $configDestination -Force | Out-Null

Push-Location -LiteralPath $repositoryRoot
try {
    $trackedFiles = & git ls-files 'servidor/**'
    if ($LASTEXITCODE -ne 0 -or -not $trackedFiles) {
        throw 'Nao foi possivel obter os arquivos versionados da API.'
    }

    foreach ($relativePath in $trackedFiles) {
        $normalized = $relativePath -replace '\\', '/'
        if ($normalized -eq 'servidor/Senhas.txt' -or
            $normalized -match '/__tests__/' -or
            $normalized -match '^servidor/tmp/' -or
            $normalized -match '^servidor/reports/' -or
            $normalized -match '^servidor/BancoLocalViewer/' -or
            $normalized -match '^servidor/node_modules/') {
            continue
        }
        $source = Join-Path $repositoryRoot ($relativePath -replace '/', '\')
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            continue
        }
        $insideServer = $normalized.Substring('servidor/'.Length) -replace '/', '\'
        $destination = Join-Path $appDestination $insideServer
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
} finally {
    Pop-Location
}

Copy-Item -LiteralPath $environmentSource -Destination (Join-Path $configDestination 'server.env') -Force
Copy-Item -LiteralPath (Get-Command node.exe -ErrorAction Stop).Source -Destination (Join-Path $runtimeNode 'node.exe') -Force
Copy-Item -LiteralPath (Get-Command cloudflared.exe -ErrorAction Stop).Source -Destination (Join-Path $runtimeCloudflared 'cloudflared.exe') -Force
Copy-Item -Path (Join-Path $templateSource '*') -Destination $resolvedOutput -Recurse -Force

$cloudflaredService = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction Stop
$tokenMatch = [regex]::Match(
    [string]$cloudflaredService.PathName,
    '(?i)--token(?:=|\s+)(?:"([^"]+)"|(\S+))'
)
if (-not $tokenMatch.Success) {
    throw 'O token do tunnel atual nao pode ser transferido automaticamente.'
}
$tunnelToken = if ($tokenMatch.Groups[1].Success) { $tokenMatch.Groups[1].Value } else { $tokenMatch.Groups[2].Value }
[IO.File]::WriteAllText((Join-Path $configDestination 'cloudflared.token'), $tunnelToken, [Text.UTF8Encoding]::new($false))
$tunnelToken = $null

Push-Location -LiteralPath $appDestination
try {
    & npm.cmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci encerrou com codigo $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

$required = @(
    'app\servidor\server.js',
    'app\servidor\package.json',
    'app\servidor\node_modules\express\package.json',
    'runtime\node\node.exe',
    'runtime\cloudflared\cloudflared.exe',
    'config\server.env',
    'config\cloudflared.token',
    'ABRIR-E-INSTALAR.cmd',
    'ATIVAR-NESTA-MAQUINA.cmd',
    'DESATIVAR-NESTA-MAQUINA.cmd',
    'VERIFICAR-SERVIDOR.cmd'
)
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedOutput $relative) -PathType Leaf)) {
        throw "Arquivo obrigatorio ausente no pacote: $relative"
    }
}

$environmentKeys = Get-Content -LiteralPath $environmentSource |
    Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } |
    ForEach-Object { (($_ -split '=', 2)[0]).Trim() } |
    Sort-Object -Unique
$fileStats = Get-ChildItem -LiteralPath $resolvedOutput -Recurse -File
$manifest = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    package = 'EoBicho-Servidor-Portatil'
    platform = 'Windows x64'
    nodeVersion = (& (Join-Path $runtimeNode 'node.exe') --version)
    cloudflaredVersion = (& (Join-Path $runtimeCloudflared 'cloudflared.exe') --version 2>$null | Select-Object -First 1)
    apiPort = 3000
    testPort = 3100
    environmentKeyCount = @($environmentKeys).Count
    secretsIncluded = $true
    secretValuesListed = $false
    fileCount = @($fileStats).Count
    totalBytes = [long](($fileStats | Measure-Object Length -Sum).Sum)
    serverSha256 = (Get-FileHash -LiteralPath (Join-Path $appDestination 'server.js') -Algorithm SHA256).Hash
    packageLockSha256 = (Get-FileHash -LiteralPath (Join-Path $appDestination 'package-lock.json') -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'pacote-manifesto.json') -Encoding UTF8

$secretFiles = @(
    (Join-Path $configDestination 'server.env'),
    (Join-Path $configDestination 'cloudflared.token')
)
foreach ($secretFile in $secretFiles) {
    (Get-Item -LiteralPath $secretFile).Attributes = (Get-Item -LiteralPath $secretFile).Attributes -bor [IO.FileAttributes]::Hidden
}

Write-Output "Pacote portatil criado em: $resolvedOutput"
Write-Output "Arquivos: $($manifest.fileCount); tamanho: $([math]::Round($manifest.totalBytes / 1GB, 2)) GB"
Write-Warning 'O pacote contem credenciais de producao. Trate o pendrive como confidencial.'
