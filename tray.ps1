Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

# Separate stdout/stderr files: Start-Process throws if both point at the same path (unlike
# shell "2>&1", it opens two independent file handles and Windows won't let them share one file).
try {
    $proc = Start-Process -FilePath python -ArgumentList "proxy.py" -WorkingDirectory $dir `
        -WindowStyle Hidden -RedirectStandardOutput "$dir\proxy.log" -RedirectStandardError "$dir\proxy.err.log" `
        -PassThru -ErrorAction Stop
} catch {
    [System.Windows.Forms.MessageBox]::Show("Could not start proxy.py: $($_.Exception.Message)", "SWAGINO proxy") | Out-Null
    exit 1
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "SWAGINO proxy - running"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open SWAGINO")
[void]$menu.Items.Add("-")
$stopItem = $menu.Items.Add("Stop server")
$notifyIcon.ContextMenuStrip = $menu

$openSwagino = { Start-Process "http://localhost:8787/swagino.html" }
$openItem.Add_Click($openSwagino)
$notifyIcon.Add_MouseDoubleClick({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { & $openSwagino }
})

$stopServer = {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
}
$stopItem.Add_Click($stopServer)

# If the proxy dies on its own (crash, killed elsewhere), don't leave a stale icon claiming
# it's still running - notice within a couple seconds and clean up.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    if ($proc.HasExited) {
        $notifyIcon.Visible = $false
        [System.Windows.Forms.Application]::Exit()
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
