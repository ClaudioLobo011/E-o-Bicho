param([Parameter(Mandatory=$true)][string]$Loja)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$runtime = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\E o Bicho PDV\E o Bicho PDV.exe' }
if (-not (Test-Path -LiteralPath $runtime)) { throw 'Instale Node.js 22.16+ ou o PDV nesta maquina para executar o downloader.' }
$destino = Join-Path $env:LOCALAPPDATA 'EoBichoBackups'
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $destino /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger a pasta de backups.' }
$credencial = Get-Credential -Message 'Informe seu usuario administrador do E o Bicho. A senha nao sera salva.'
if (-not $credencial) { throw 'Cancelado.' }
$previous = $env:ELECTRON_RUN_AS_NODE
try {
    $env:PDV_BACKUP_USER = $credencial.UserName
    $env:PDV_BACKUP_PASSWORD = $credencial.GetNetworkCredential().Password
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $runtime (Join-Path $PSScriptRoot 'baixar-backup.cjs') $Loja $destino | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Download nao concluido. Confira a mensagem acima.' }
} finally {
    Remove-Item Env:PDV_BACKUP_USER -ErrorAction SilentlyContinue
    Remove-Item Env:PDV_BACKUP_PASSWORD -ErrorAction SilentlyContinue
    $env:ELECTRON_RUN_AS_NODE = $previous
}
