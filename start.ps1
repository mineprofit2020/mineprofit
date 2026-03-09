# MineProfit Server Starter
# Double-click this file or run: powershell -ExecutionPolicy Bypass -File start.ps1

$port = 3000
$host_ = "localhost"

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  MineProfit Server Starting...      " -ForegroundColor Yellow
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Show popup with URLs
$urls = @"
MineProfit is running!

Login:      http://${host_}:${port}/login.html
Register:   http://${host_}:${port}/register.html
Dashboard:  http://${host_}:${port}/dashboard.html
Shop:       http://${host_}:${port}/shop.html
Spin:       http://${host_}:${port}/spin.html
Games:      http://${host_}:${port}/games.html
Deposit:    http://${host_}:${port}/payment.html
Withdraw:   http://${host_}:${port}/withdrawal.html
Admin:      http://${host_}:${port}/admin.html

Press OK to open in browser.
"@

# Start server in background
$serverProcess = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow

# Wait a moment for the server to start
Start-Sleep -Seconds 2

# Show popup
Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show($urls, "MineProfit Server", [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Information)

if ($result -eq "OK") {
    Start-Process "http://${host_}:${port}/dashboard.html"
}

Write-Host "Server running at http://${host_}:${port}" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

# Wait for server process
try {
    $serverProcess.WaitForExit()
} catch {
    # User pressed Ctrl+C
    if ($serverProcess -and !$serverProcess.HasExited) {
        $serverProcess.Kill()
    }
}
