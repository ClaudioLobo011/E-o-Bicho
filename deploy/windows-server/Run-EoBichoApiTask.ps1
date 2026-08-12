$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$serverDirectory = Join-Path $repositoryRoot 'servidor'
$serverEntry = Join-Path $serverDirectory 'server.js'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source

$env:NODE_ENV = 'production'
$env:PORT = '3000'

Set-Location -LiteralPath $serverDirectory
& $nodeExecutable $serverEntry
exit $LASTEXITCODE
