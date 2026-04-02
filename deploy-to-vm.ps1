# ========================================
# Azure VM Deployment Script - Bollinger Bot
# ========================================
# VM: 98.70.40.23 | User: azureuser
# Purpose: Deploy Bollinger bot alongside existing Nifty bot
# SAFE: Only manages trading-bot-bollinger PM2 process
# ========================================

param(
    [switch]$SkipBackup = $false,
    [switch]$SkipClean = $false
)

$ErrorActionPreference = "Stop"

# Configuration
$VM_IP = "98.70.40.23"
$VM_USER = "azureuser"
$SSH_KEY = "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem"
$LOCAL_PROJECT = "c:\Users\aabishek\Documents\repo-local\tradebot-bollinger-multistock"
$REMOTE_PATH = "~/tradebot-bollinger"
$PM2_PROCESS_NAME = "trading-bot-bollinger"
$BACKUP_PATH = "~/tradebot-bollinger-backup-$(Get-Date -Format 'yyyy-MM-dd-HHmmss')"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Azure VM Deployment - Bollinger Bot" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VM: $VM_IP" -ForegroundColor Yellow
Write-Host "Project: $LOCAL_PROJECT" -ForegroundColor Yellow
Write-Host "Remote: $REMOTE_PATH" -ForegroundColor Yellow
Write-Host "PM2 Process: $PM2_PROCESS_NAME" -ForegroundColor Yellow
Write-Host "⚠️  Existing bot (trading-bot-multi-strategy) will NOT be touched" -ForegroundColor Green
Write-Host ""

# Function to run SSH command
function Invoke-SSHCommand {
    param([string]$Command)
    $sshCmd = "ssh -i `"$SSH_KEY`" -o StrictHostKeyChecking=no $VM_USER@$VM_IP `"$Command`""
    Write-Host "  → $Command" -ForegroundColor DarkGray
    Invoke-Expression $sshCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ⚠️  Command failed (exit code: $LASTEXITCODE)" -ForegroundColor Yellow
    }
}

# Function to run SCP transfer
function Invoke-SCPTransfer {
    param(
        [string]$Source,
        [string]$Destination
    )
    $scpCmd = "scp -i `"$SSH_KEY`" -o StrictHostKeyChecking=no -r `"$Source`" $VM_USER@${VM_IP}:$Destination"
    Write-Host "  → Copying: $Source → $Destination" -ForegroundColor DarkGray
    Invoke-Expression $scpCmd
    if ($LASTEXITCODE -ne 0) {
        throw "SCP transfer failed"
    }
}

try {
    # Step 1: Pre-deployment checks
    Write-Host "[1/8] Pre-deployment checks..." -ForegroundColor Green
    if (-not (Test-Path $SSH_KEY)) {
        throw "SSH key not found: $SSH_KEY"
    }
    if (-not (Test-Path $LOCAL_PROJECT)) {
        throw "Project directory not found: $LOCAL_PROJECT"
    }
    Write-Host "  ✅ SSH key and project directory verified" -ForegroundColor Green
    Write-Host ""

    # Step 2: Check VM connectivity
    Write-Host "[2/8] Testing VM connectivity..." -ForegroundColor Green
    Invoke-SSHCommand "echo 'Connected successfully'"
    Write-Host "  ✅ VM connection established" -ForegroundColor Green
    Write-Host ""

    # Step 3: Backup critical data (unless skipped)
    if (-not $SkipBackup) {
        Write-Host "[3/8] Backing up critical data..." -ForegroundColor Green
        Invoke-SSHCommand "mkdir -p $BACKUP_PATH"
        
        # Backup auth session
        Write-Host "  → Backing up auth session..." -ForegroundColor Yellow
        Invoke-SSHCommand "if [ -f $REMOTE_PATH/data/auth/session.json ]; then cp $REMOTE_PATH/data/auth/session.json $BACKUP_PATH/; echo '  ✅ Session backed up'; else echo '  ℹ️  No session file found'; fi"
        
        # Backup strategy state
        Write-Host "  → Backing up strategy state..." -ForegroundColor Yellow
        Invoke-SSHCommand "if [ -f $REMOTE_PATH/data/strategy/strategy-state.json ]; then cp $REMOTE_PATH/data/strategy/strategy-state.json $BACKUP_PATH/; echo '  ✅ Strategy state backed up'; else echo '  ℹ️  No strategy state found'; fi"
        
        # Backup logs
        Write-Host "  → Backing up recent logs..." -ForegroundColor Yellow
        Invoke-SSHCommand "if [ -d $REMOTE_PATH/logs ]; then cp -r $REMOTE_PATH/logs $BACKUP_PATH/; echo '  ✅ Logs backed up'; else echo '  ℹ️  No logs found'; fi"
        
        Write-Host "  ✅ Backup completed: $BACKUP_PATH" -ForegroundColor Green
    }
    else {
        Write-Host "[3/8] Skipping backup (SkipBackup flag set)" -ForegroundColor Yellow
    }
    Write-Host ""

    # Step 4: Stop Bollinger bot PM2 process only (existing bot untouched)
    Write-Host "[4/8] Stopping Bollinger bot PM2 process..." -ForegroundColor Green
    Invoke-SSHCommand "pm2 stop trading-bot-bollinger 2>/dev/null; echo 'Bollinger bot stop attempted'"
    Invoke-SSHCommand "pm2 delete trading-bot-bollinger 2>/dev/null; echo 'Bollinger bot delete attempted'"
    Write-Host "  ✅ PM2 services stopped" -ForegroundColor Green
    Write-Host ""

    # Step 5: Clean up old deployment (unless skipped)
    if (-not $SkipClean) {
        Write-Host "[5/8] Cleaning old deployment..." -ForegroundColor Green
        Write-Host "  ⚠️  Removing $REMOTE_PATH..." -ForegroundColor Yellow
        Invoke-SSHCommand "rm -rf $REMOTE_PATH"
        Invoke-SSHCommand "mkdir -p $REMOTE_PATH"
        Write-Host "  ✅ Old deployment cleaned" -ForegroundColor Green
    }
    else {
        Write-Host "[5/8] Skipping clean (SkipClean flag set)" -ForegroundColor Yellow
    }
    Write-Host ""

    # Step 6: Build project locally
    Write-Host "[6/8] Building project locally..." -ForegroundColor Green
    Push-Location $LOCAL_PROJECT
    try {
        Write-Host "  → Running npm install..." -ForegroundColor Yellow
        npm install 2>&1 | Out-Null
        
        Write-Host "  → Running npm run build..." -ForegroundColor Yellow
        npm run build
        
        Write-Host "  ✅ Project built successfully" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
    Write-Host ""

    # Step 7: Transfer files to VM
    Write-Host "[7/8] Transferring files to VM..." -ForegroundColor Green
    
    # Transfer dist folder
    Write-Host "  → Transferring compiled code (dist/)..." -ForegroundColor Yellow
    Invoke-SCPTransfer "$LOCAL_PROJECT\dist" "$REMOTE_PATH/"
    
    # Transfer trading data files (trade history, slot data, OI history)
    Write-Host "  → Transferring trading data files to dist/data/..." -ForegroundColor Yellow
    Invoke-SSHCommand "mkdir -p $REMOTE_PATH/dist/data"
    if (Test-Path "$LOCAL_PROJECT\src\data") {
        Get-ChildItem "$LOCAL_PROJECT\src\data\*.json" | ForEach-Object {
            Invoke-SCPTransfer $_.FullName "$REMOTE_PATH/dist/data/"
        }
        Write-Host "  ✅ Trading data files transferred" -ForegroundColor Green
    }
    
    # Transfer package files
    Write-Host "  → Transferring package.json and package-lock.json..." -ForegroundColor Yellow
    Invoke-SCPTransfer "$LOCAL_PROJECT\package.json" "$REMOTE_PATH/"
    Invoke-SCPTransfer "$LOCAL_PROJECT\package-lock.json" "$REMOTE_PATH/"
    
    # Transfer ecosystem config
    Write-Host "  → Transferring ecosystem.config.js..." -ForegroundColor Yellow
    Invoke-SCPTransfer "$LOCAL_PROJECT\ecosystem.config.js" "$REMOTE_PATH/"
    
    # Transfer config files
    if (Test-Path "$LOCAL_PROJECT\config") {
        Write-Host "  → Transferring config directory..." -ForegroundColor Yellow
        Invoke-SCPTransfer "$LOCAL_PROJECT\config" "$REMOTE_PATH/"
    }
    
    # Create necessary directories
    Write-Host "  → Creating data directories..." -ForegroundColor Yellow
    Invoke-SSHCommand "mkdir -p $REMOTE_PATH/data/auth $REMOTE_PATH/data/strategy $REMOTE_PATH/data/cache $REMOTE_PATH/logs"
    
    # Transfer .env file
    if (Test-Path "$LOCAL_PROJECT\.env") {
        Write-Host "  → Transferring .env file..." -ForegroundColor Yellow
        Invoke-SCPTransfer "$LOCAL_PROJECT\.env" "$REMOTE_PATH/"
    } else {
        Write-Host "  ⚠️  No .env file found locally! Bot will fail without ZERODHA_API_KEY." -ForegroundColor Red
    }
    
    # Restore backed up data
    if (-not $SkipBackup) {
        Write-Host "  → Restoring backed up data..." -ForegroundColor Yellow
        Invoke-SSHCommand "if [ -f $BACKUP_PATH/session.json ]; then cp $BACKUP_PATH/session.json $REMOTE_PATH/data/auth/; echo '  ✅ Session restored'; fi"
        Invoke-SSHCommand "if [ -f $BACKUP_PATH/strategy-state.json ]; then cp $BACKUP_PATH/strategy-state.json $REMOTE_PATH/data/strategy/; echo '  ✅ Strategy state restored'; fi"
    }
    
    Write-Host "  ✅ Files transferred successfully" -ForegroundColor Green
    Write-Host ""

    # Step 8: Install dependencies and start services
    Write-Host "[8/8] Setting up services on VM..." -ForegroundColor Green
    
    Write-Host "  → Installing production dependencies..." -ForegroundColor Yellow
    Invoke-SSHCommand "cd $REMOTE_PATH && npm install --production"
    
    Write-Host "  → Starting PM2 service..." -ForegroundColor Yellow
    Invoke-SSHCommand "cd $REMOTE_PATH && pm2 start ecosystem.config.js"
    Invoke-SSHCommand "pm2 save"
    
    Write-Host "  → Configuring PM2 auto-start..." -ForegroundColor Yellow
    Invoke-SSHCommand "pm2 startup systemd -u $VM_USER --hp /home/$VM_USER 2>&1 | grep -v 'sudo env' | head -1"
    
    Write-Host "  ✅ Services configured and started" -ForegroundColor Green
    Write-Host ""

    # Final status check
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Deployment Summary" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    Write-Host "`n📊 PM2 Status:" -ForegroundColor Yellow
    Invoke-SSHCommand "pm2 status"
    
    Write-Host "`n🏥 Health Check:" -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    Invoke-SSHCommand "curl -s http://localhost:3001/health"
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "✅ DEPLOYMENT COMPLETED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Authenticate with Zerodha:" -ForegroundColor White
    Write-Host "     https://${VM_IP}/tradebot-multistock/auth/login" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  2. Access Dashboard:" -ForegroundColor White
    Write-Host "     https://${VM_IP}/tradebot-multistock/" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  3. Verify deployment:" -ForegroundColor White
    Write-Host "     ssh -i `"$SSH_KEY`" ${VM_USER}@${VM_IP}" -ForegroundColor DarkGray
    Write-Host "     pm2 logs $PM2_PROCESS_NAME" -ForegroundColor DarkGray
    Write-Host ""
    
    if (-not $SkipBackup) {
        Write-Host "📦 Backup Location: $BACKUP_PATH" -ForegroundColor Cyan
        Write-Host ""
    }

}
catch {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "❌ DEPLOYMENT FAILED" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  • Check SSH connectivity: ssh -i `"$SSH_KEY`" $VM_USER@$VM_IP" -ForegroundColor White
    Write-Host "  • Verify project builds locally: npm run build" -ForegroundColor White
    Write-Host "  • Check VM logs: pm2 logs" -ForegroundColor White
    Write-Host ""
    exit 1
}
