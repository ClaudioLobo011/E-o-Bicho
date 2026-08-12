[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'EoBicho-API' -ErrorAction SilentlyContinue
if ($task -and $task.State -ne 'Disabled') {
    if ($PSCmdlet.ShouldProcess('EoBicho-API', 'Parar tarefa agendada')) {
        Stop-ScheduledTask -TaskName 'EoBicho-API' -ErrorAction SilentlyContinue
    }
}

$listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $owner -or $owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch 'server\.js') {
        throw "A porta $Port pertence a um processo que nao foi reconhecido como a API. Nada foi encerrado."
    }
    if ($PSCmdlet.ShouldProcess("PID $($owner.ProcessId)", 'Encerrar API E o Bicho')) {
        Stop-Process -Id $owner.ProcessId -Force
    }
}
