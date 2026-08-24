$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*proxy.py*' }
if ($procs) {
    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Host 'SWAGINO proxy stopped.'
} else {
    Write-Host 'SWAGINO proxy was not running.'
}
