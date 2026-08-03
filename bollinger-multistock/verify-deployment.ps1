# ========================================
# Bollinger VM Deployment Verification Script
# ========================================
# Run this after deployment to verify everything is working
# ========================================

param(
    [string]$Detailed = "false"
)

$ErrorActionPreference = "Continue"

# Configuration
$VM_IP = "98.70.40.23"
$VM_USER = "azureuser"
$SSH_KEY = "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem"
$REMOTE_PATH = "~/tradebot-bollinger"
$PORT = 3001
$PM2_PROCESS_NAME = "trading-bot-bollinger"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Bollinger VM Deployment Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VM: $VM_IP" -ForegroundColor Yellow
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow
Write-Host ""

# Function to run SSH command
function Invoke-SSHCommand {
    param([string]$Command, [switch]$Silent)
    $sshCmd = "ssh -i `"$SSH_KEY`" -o StrictHostKeyChecking=no $VM_USER@$VM_IP `"$Command`""
    if (-not $Silent) {
        Write-Host "  → $Command" -ForegroundColor DarkGray
    }
    $output = Invoke-Expression $sshCmd 2>&1
    return $output
}

# Test 1: VM Connectivity
Write-Host "[1/10] Testing VM connectivity..." -ForegroundColor Green
try {
    $result = Invoke-SSHCommand "echo 'OK'" -Silent
    if ($result -match "OK") {
        Write-Host "  ✅ VM accessible" -ForegroundColor Green
    } else {
        Write-Host "  ❌ VM connection failed" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ Cannot connect to VM" -ForegroundColor Red
}
Write-Host ""

# Test 2: VM Timezone
Write-Host "[2/10] Checking VM timezone..." -ForegroundColor Green
$timezone = Invoke-SSHCommand "timedatectl | grep 'Time zone'" -Silent
Write-Host "  $timezone" -ForegroundColor White
if ($timezone -match "Asia/Kolkata") {
    Write-Host "  ✅ Correct timezone (IST)" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Timezone not set to Asia/Kolkata" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: Project Directory
Write-Host "[3/10] Checking project directory..." -ForegroundColor Green
$dirCheck = Invoke-SSHCommand "if [ -d $REMOTE_PATH ]; then echo 'EXISTS'; else echo 'MISSING'; fi" -Silent
if ($dirCheck -match "EXISTS") {
    Write-Host "  ✅ Project directory exists: $REMOTE_PATH" -ForegroundColor Green
    
    # Check key files
    $files = @("dist/index.js", "package.json", "ecosystem.config.js", ".env")
    foreach ($file in $files) {
        $fileCheck = Invoke-SSHCommand "if [ -f $REMOTE_PATH/$file ]; then echo 'OK'; else echo 'MISSING'; fi" -Silent
        if ($fileCheck -match "OK") {
            Write-Host "    ✅ $file" -ForegroundColor DarkGreen
        } else {
            Write-Host "    ❌ $file (missing)" -ForegroundColor Red
        }
    }
} else {
    Write-Host "  ❌ Project directory not found" -ForegroundColor Red
}
Write-Host ""

# Test 4: Node.js & NPM
Write-Host "[4/10] Checking Node.js environment..." -ForegroundColor Green
$nodeVersion = Invoke-SSHCommand "node --version" -Silent
$npmVersion = Invoke-SSHCommand "npm --version" -Silent
Write-Host "  Node.js: $nodeVersion" -ForegroundColor White
Write-Host "  NPM: $npmVersion" -ForegroundColor White
if ($nodeVersion -and $npmVersion) {
    Write-Host "  ✅ Node.js environment ready" -ForegroundColor Green
} else {
    Write-Host "  ❌ Node.js/NPM not installed" -ForegroundColor Red
}
Write-Host ""

# Test 5: Dependencies
Write-Host "[5/10] Checking dependencies..." -ForegroundColor Green
$nodeModules = Invoke-SSHCommand "if [ -d $REMOTE_PATH/node_modules ]; then echo 'OK'; else echo 'MISSING'; fi" -Silent
if ($nodeModules -match "OK") {
    $depCount = Invoke-SSHCommand "ls -1 $REMOTE_PATH/node_modules | wc -l" -Silent
    Write-Host "  ✅ Dependencies installed ($depCount packages)" -ForegroundColor Green
} else {
    Write-Host "  ❌ Dependencies not installed (run: npm install --production)" -ForegroundColor Red
}
Write-Host ""

# Test 6: PM2 Status
Write-Host "[6/10] Checking PM2 status..." -ForegroundColor Green
$pm2Status = Invoke-SSHCommand "pm2 jlist 2>/dev/null" -Silent
if ($pm2Status) {
    try {
        $pm2Json = $pm2Status | ConvertFrom-Json
        if ($pm2Json.Count -gt 0) {
            foreach ($proc in $pm2Json) {
                $statusColor = if ($proc.pm2_env.status -eq "online") { "Green" } else { "Red" }
                $statusIcon = if ($proc.pm2_env.status -eq "online") { "✅" } else { "❌" }
                Write-Host "  $statusIcon $($proc.name): $($proc.pm2_env.status)" -ForegroundColor $statusColor
                Write-Host "    Uptime: $([math]::Round($proc.pm2_env.pm_uptime / 1000 / 60, 1)) minutes" -ForegroundColor DarkGray
                Write-Host "    Memory: $([math]::Round($proc.monit.memory / 1MB, 1)) MB" -ForegroundColor DarkGray
                Write-Host "    Restarts: $($proc.pm2_env.restart_time)" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "  ⚠️  No PM2 processes running" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ⚠️  Could not parse PM2 status" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ❌ PM2 not running or not installed" -ForegroundColor Red
}
Write-Host ""

# Test 7: Application Health
Write-Host "[7/10] Checking application health..." -ForegroundColor Green
Start-Sleep -Seconds 2
$health = Invoke-SSHCommand "curl -s http://localhost:$PORT/health 2>/dev/null" -Silent
if ($health) {
    try {
        $healthJson = $health | ConvertFrom-Json
        Write-Host "  ✅ Application responding" -ForegroundColor Green
        Write-Host "    Status: $($healthJson.status)" -ForegroundColor White
        if ($healthJson.version) {
            Write-Host "    Version: $($healthJson.version)" -ForegroundColor White
        }
    } catch {
        Write-Host "  ⚠️  Application responding but invalid health format" -ForegroundColor Yellow
        Write-Host "    Response: $health" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  ❌ Application not responding (check PM2 logs)" -ForegroundColor Red
}
Write-Host ""

# Test 8: Authentication Status
Write-Host "[8/10] Checking authentication status..." -ForegroundColor Green
$authStatus = Invoke-SSHCommand "curl -s http://localhost:$PORT/auth/status 2>/dev/null" -Silent
if ($authStatus) {
    try {
        $authJson = $authStatus | ConvertFrom-Json
        if ($authJson.authenticated) {
            Write-Host "  ✅ Authenticated with Zerodha" -ForegroundColor Green
            if ($authJson.profile) {
                Write-Host "    User: $($authJson.profile.user_name)" -ForegroundColor White
                Write-Host "    Email: $($authJson.profile.email)" -ForegroundColor White
            }
        } else {
            Write-Host "  ⚠️  Not authenticated - visit: http://$VM_IP`:$PORT/auth/login" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ⚠️  Could not check auth status" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ❌ Cannot reach auth endpoint" -ForegroundColor Red
}
Write-Host ""

# Test 9: Strategy Status
Write-Host "[9/10] Checking strategy status..." -ForegroundColor Green
$strategies = Invoke-SSHCommand "curl -s http://localhost:$PORT/strategies 2>/dev/null" -Silent
if ($strategies) {
    try {
        $stratJson = $strategies | ConvertFrom-Json
        if ($stratJson.Count -gt 0) {
            Write-Host "  ✅ Strategies loaded ($($stratJson.Count) strategies)" -ForegroundColor Green
            foreach ($strat in $stratJson) {
                $activeIcon = if ($strat.isActive) { "🟢" } else { "⚪" }
                $autoStartIcon = if ($strat.autoStart) { "🔄" } else { "⏸️" }
                Write-Host "    $activeIcon $($strat.name) | AutoStart: $autoStartIcon" -ForegroundColor White
                if ($strat.lastError) {
                    Write-Host "      ⚠️  Error: $($strat.lastError)" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host "  ⚠️  No strategies configured" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ⚠️  Could not parse strategy status" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ❌ Cannot reach strategies endpoint" -ForegroundColor Red
}
Write-Host ""

# Test 10: Recent Logs
Write-Host "[10/10] Checking recent logs..." -ForegroundColor Green
$recentLogs = Invoke-SSHCommand "pm2 logs $PM2_PROCESS_NAME --lines 5 --nostream 2>/dev/null | tail -8" -Silent
if ($recentLogs) {
    Write-Host "  📜 Recent activity:" -ForegroundColor White
    $recentLogs -split "`n" | ForEach-Object {
        if ($_ -match "error|Error|ERROR") {
            Write-Host "    $_" -ForegroundColor Red
        } elseif ($_ -match "warn|Warning|WARN") {
            Write-Host "    $_" -ForegroundColor Yellow
        } else {
            Write-Host "    $_" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  ⚠️  No logs available" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Quick Access URLs:" -ForegroundColor Yellow
Write-Host "  Dashboard:      http://$VM_IP`:$PORT/" -ForegroundColor White
Write-Host "  Health Check:   http://$VM_IP`:$PORT/health" -ForegroundColor White
Write-Host "  Auth Login:     http://$VM_IP`:$PORT/auth/login" -ForegroundColor White
Write-Host "  Strategies:     http://$VM_IP`:$PORT/strategies" -ForegroundColor White
Write-Host ""
Write-Host "🔧 Common Commands:" -ForegroundColor Yellow
Write-Host "  SSH to VM:      ssh -i `"$SSH_KEY`" $VM_USER@$VM_IP" -ForegroundColor DarkGray
Write-Host "  View logs:      pm2 logs $PM2_PROCESS_NAME" -ForegroundColor DarkGray
Write-Host "  Restart:        pm2 restart $PM2_PROCESS_NAME" -ForegroundColor DarkGray
Write-Host "  Check status:   pm2 status" -ForegroundColor DarkGray
Write-Host ""

# Detailed mode
if ($Detailed -eq "true") {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Detailed Information" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "📁 Directory Structure:" -ForegroundColor Yellow
    Invoke-SSHCommand "ls -lh $REMOTE_PATH" -Silent
    Write-Host ""
    
    Write-Host "💾 Disk Usage:" -ForegroundColor Yellow
    Invoke-SSHCommand "df -h | grep -E 'Filesystem|/$'" -Silent
    Write-Host ""
    
    Write-Host "🧠 Memory Usage:" -ForegroundColor Yellow
    Invoke-SSHCommand "free -h" -Silent
    Write-Host ""
}
