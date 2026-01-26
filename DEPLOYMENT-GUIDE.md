# Azure VM Deployment Guide

## Quick Deployment (Fresh Install)

### Prerequisites

1. **Local Setup**: Have your `.env` file ready with Zerodha credentials
2. **VM Access**: SSH key at `C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem`
3. **Build Ready**: Project builds successfully locally

### Step 1: Deploy to VM

```powershell
# Run the deployment script
.\deploy-to-vm.ps1
```

This script will:

- ✅ Backup existing data (auth session, strategy state, logs)
- ✅ Stop PM2 services
- ✅ Clean old deployment
- ✅ Build project locally
- ✅ Transfer files to VM
- ✅ Install dependencies
- ✅ Start PM2 with auto-restart
- ✅ Restore backed-up data

**Deployment takes ~2-5 minutes**

### Step 2: Copy Environment Variables

```powershell
# Copy your .env file to the VM
scp -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" .env azureuser@98.70.40.23:~/tradebot-kite/
```

### Step 3: Restart Service with New Environment

```bash
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
cd ~/tradebot-kite
pm2 restart ecosystem.config.js
```

### Step 4: Verify Deployment

```powershell
# Run verification script
.\verify-deployment.ps1
```

### Step 5: Authenticate with Zerodha

Open in browser:

```
http://98.70.40.23:3000/auth/login
```

### Step 6: Access Dashboard

```
http://98.70.40.23:3000/
```

---

## Deployment Options

### Full Deployment (Default)

```powershell
.\deploy-to-vm.ps1
```

### Skip Backup (Faster)

```powershell
.\deploy-to-vm.ps1 -SkipBackup
```

### Skip Clean (Keep Existing Files)

```powershell
.\deploy-to-vm.ps1 -SkipClean
```

---

## Post-Deployment Checklist

- [ ] PM2 service running (`pm2 status`)
- [ ] Health check responding (`curl http://localhost:3000/health`)
- [ ] Authenticated with Zerodha (`/auth/status`)
- [ ] Strategies loaded (`/strategies`)
- [ ] Auto-start configured (`pm2 startup`)
- [ ] Logs accessible (`pm2 logs`)

---

## Common Issues

### Issue: Service not starting

```bash
# Check logs
pm2 logs trading-bot-multi-strategy --err

# Restart with environment reload
pm2 delete trading-bot-multi-strategy
pm2 start ecosystem.config.js
```

### Issue: Environment variables not loading

```bash
# Verify .env exists
cat ~/tradebot-kite/.env

# Restart PM2
pm2 restart ecosystem.config.js
```

### Issue: Authentication fails

1. Visit `http://98.70.40.23:3000/auth/login`
2. Complete Zerodha OAuth flow
3. Session will be saved automatically

### Issue: Old session conflicts

```bash
# Clear old session
rm ~/tradebot-kite/data/auth/session.json
# Restart and re-authenticate
pm2 restart trading-bot-multi-strategy
```

---

## Daily Operations

### Morning Startup (After 9:00 AM)

```bash
# VM auto-starts the bot via PM2
# Just verify:
pm2 status
curl http://localhost:3000/health
```

### Check Active Trades

```bash
curl -s http://localhost:3000/strategies | grep -E "isActive|hasPosition"
```

### View Recent Activity

```bash
pm2 logs trading-bot-multi-strategy --lines 20
```

### Pre-Shutdown Check (Before 4:30 PM)

```bash
# Verify no active positions
curl -s http://localhost:3000/strategies
pm2 logs trading-bot-multi-strategy --lines 10 | grep -i position
```

---

## Maintenance

### Update Code

```powershell
# From local machine
.\deploy-to-vm.ps1
```

### Backup Data Manually

```bash
# On VM
mkdir -p ~/backups
cp -r ~/tradebot-kite/data ~/backups/data-$(date +%Y%m%d-%H%M%S)
cp -r ~/tradebot-kite/logs ~/backups/logs-$(date +%Y%m%d-%H%M%S)
```

### View Historical Backups

```bash
ls -lh ~/tradebot-backup-*
```

### Restore from Backup

```bash
# Find backup
ls -lh ~/tradebot-backup-*

# Restore (example)
cp ~/tradebot-backup-2025-11-12-093000/session.json ~/tradebot-kite/data/auth/
pm2 restart trading-bot-multi-strategy
```

---

## Monitoring

### Health Dashboard

```
http://98.70.40.23:3000/
```

### Strategy-Specific Dashboards

- Bollinger Band: `http://98.70.40.23:3000/strategy/bollinger-band-01`

### PM2 Web Monitoring (Optional)

```bash
pm2 install pm2-server-monit
```

### Log Monitoring

```bash
# Follow live logs
pm2 logs trading-bot-multi-strategy --lines 0

# Filter errors only
pm2 logs trading-bot-multi-strategy --err

# Search logs
grep -i "error\|trade\|position" ~/tradebot-kite/logs/*.log
```

---

## Security Best Practices

1. **Never commit `.env` to git**
2. **Keep SSH key secure** (`nifty-trading-bot_key.pem`)
3. **Rotate Zerodha API keys** periodically
4. **Monitor API usage** on Kite dashboard
5. **Review logs regularly** for suspicious activity
6. **Backup data daily** (automated backups recommended)

---

## Quick Reference

| Task      | Command                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| Deploy    | `.\deploy-to-vm.ps1`                                                                   |
| Verify    | `.\verify-deployment.ps1`                                                              |
| SSH to VM | `ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23` |
| View logs | `pm2 logs trading-bot-multi-strategy`                                                  |
| Restart   | `pm2 restart trading-bot-multi-strategy`                                               |
| Status    | `pm2 status`                                                                           |
| Health    | `curl http://localhost:3000/health`                                                    |

---

## Troubleshooting Deployment

### Deployment Script Fails

1. **Check SSH connectivity**

   ```powershell
   ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23 "echo OK"
   ```

2. **Check local build**

   ```powershell
   npm install
   npm run build
   ```

3. **Check VM disk space**

   ```bash
   ssh -i "..." azureuser@98.70.40.23 "df -h"
   ```

4. **Check PM2 process limit**
   ```bash
   pm2 list
   pm2 delete all  # If too many processes
   ```

### Re-run Deployment with Debugging

```powershell
# Enable verbose output
$VerbosePreference = "Continue"
.\deploy-to-vm.ps1
```

---

## Support

For issues, check:

1. **Logs**: `pm2 logs trading-bot-multi-strategy --err`
2. **Health**: `http://98.70.40.23:3000/health`
3. **Zerodha API Status**: https://status.kite.trade/
4. **VM Resources**: `htop`, `df -h`, `free -h`
