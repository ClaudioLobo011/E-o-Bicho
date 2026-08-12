[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Windows', 'Render')]
    [string]$Target,

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$configPath = Join-Path $repoRoot 'scripts\core\config.js'
$renderOrigin = 'https://e-o-bicho.onrender.com'
$windowsOrigin = 'https://api.peteobicho.com.br'
$desiredOrigin = if ($Target -eq 'Windows') { $windowsOrigin } else { $renderOrigin }
$knownOrigins = @($renderOrigin, $windowsOrigin)
$content = Get-Content -Raw -LiteralPath $configPath

$matches = @($knownOrigins | Where-Object { $content.Contains("const DEFAULT_RENDER_SERVER_URL = '$_';") })
if ($matches.Count -ne 1) {
    throw 'A origem padrao nao corresponde exatamente a um estado conhecido. Revise config.js manualmente.'
}

$currentOrigin = $matches[0]
Write-Output "Origem atual: $currentOrigin"
Write-Output "Origem solicitada: $desiredOrigin"

if ($currentOrigin -eq $desiredOrigin) {
    Write-Output 'Nenhuma alteracao necessaria.'
    exit 0
}
if (-not $Apply) {
    Write-Output 'Simulacao concluida. Repita com -Apply somente durante cutover ou rollback autorizado.'
    exit 0
}

$oldLine = "const DEFAULT_RENDER_SERVER_URL = '$currentOrigin';"
$newLine = "const DEFAULT_RENDER_SERVER_URL = '$desiredOrigin';"
if ($PSCmdlet.ShouldProcess($configPath, "Trocar API para $desiredOrigin")) {
    $updated = $content.Replace($oldLine, $newLine)
    [System.IO.File]::WriteAllText($configPath, $updated, [System.Text.UTF8Encoding]::new($false))
    Write-Output 'Arquivo atualizado. Ainda e necessario revisar, testar, versionar e publicar na Vercel.'
}
