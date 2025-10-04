# 🖥️ Azure VM Management Guide

# NIFTY Trading Bot - Complete Operations Manual

**VM Information:**

- **Public IP**: `98.70.40.23`
- **VM Type**: B2s (2 vCPU, 4GB RAM)
- **OS**: Ubuntu 24.04 LTS
- **Region**: Central India
- **SSH Key**: `nifty-trading-bot_key.pem` (in Downloads folder)
- **Username**: `azureuser`

---

## 📋 Table of Contents

1. [Daily Operations](#daily-operations)
2. [SSH Connection & Access](#ssh-connection--access)
3. [Application Management](#application-management)
4. [Debugging & Troubleshooting](#debugging--troubleshooting)
5. [Log Management](#log-management)
6. [System Monitoring](#system-monitoring)
7. [Code Deployment](#code-deployment)
8. [SSL & HTTPS Management](#ssl--https-management)
9. [Emergency Procedures](#emergency-procedures)
10. [Cost Management](#cost-management)

---

## 🌅 Daily Operations

### **Morning Startup Routine (8:00 AM IST)**

1. **Start VM from Azure Portal**

   ```
   Azure Portal → Virtual Machines → nifty-trading-bot → Start
   Wait 2-3 minutes for full boot
   ```

2. **Verify Services (Optional - Usually auto-starts)**

   ```bash
   # SSH into VM
   ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23

   # Check application status
   pm2 status

   # If stopped, restart
   pm2 restart nifty-trading-bot
   ```

3. **Access Trading Dashboard**

   ```
   Browser: https://98.70.40.23
   (Accept security warning for self-signed certificate)
   ```

4. **Authenticate with Zerodha (8:30 AM - After market prep)**
   ```
   Click "Daily Login" → Complete Zerodha OAuth
   ```

### **Evening Shutdown Routine (4:30 PM IST)**

1. **Stop VM from Azure Portal (Manual)**

   ```
   Azure Portal → Virtual Machines → nifty-trading-bot → Stop (deallocated)
   ```

2. **Verify Shutdown**
   ```
   Status should show "Stopped (deallocated)" for cost savings
   ```

---

## 🔐 SSH Connection & Access

### **Basic SSH Connection**

```powershell
# From Windows PowerShell
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23
```

### **SSH with Command Execution**

```powershell
# Execute single command remotely
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23 "pm2 status"

# Execute multiple commands
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23 "pm2 status && df -h"
```

### **Troubleshooting SSH Issues**

**Permission Denied Error:**

```powershell
# Check if key file exists
dir C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem

# If permission issues, fix key permissions (if needed)
icacls C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem /inheritance:r /grant:r "%username%:R"
```

**Connection Timeout:**

```bash
# Check if VM is running in Azure Portal
# Check if firewall allows SSH (port 22)
ssh -v -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23
```

---

## 🤖 Application Management

### **PM2 Process Management**

**Check Application Status:**

```bash
# Basic status
pm2 status

# Detailed information
pm2 show nifty-trading-bot

# Monitor in real-time
pm2 monit
```

**Start/Stop/Restart Application:**

```bash
# Start application
pm2 start nifty-trading-bot

# Stop application
pm2 stop nifty-trading-bot

# Restart application
pm2 restart nifty-trading-bot

# Restart with environment refresh
pm2 restart nifty-trading-bot --update-env

# Delete process (careful!)
pm2 delete nifty-trading-bot
```

**Application Health Checks:**

```bash
# Test local health endpoint
curl http://localhost:3000/health

# Test HTTPS endpoint
curl -k https://98.70.40.23/health

# Test authentication status
curl http://localhost:3000/auth/status
```

### **Manual Application Startup (If Needed)**

```bash
# Navigate to project directory
cd ~/tradebot-kite

# Build TypeScript
npm run build

# Start with PM2
pm2 start dist/index.js --name nifty-trading-bot

# Save PM2 configuration
pm2 save
```

---

## 🐛 Debugging & Troubleshooting

### **Common Issues & Solutions**

**1. Application Won't Start:**

```bash
# Check for build errors
cd ~/tradebot-kite
npm run build

# Check environment variables
cat .env

# Check for missing dependencies
npm install

# Start in debug mode
node dist/index.js
```

**2. Authentication Failures:**

```bash
# Check session persistence
ls -la ~/tradebot-kite/data/

# Check environment variables
grep ZERODHA .env

# Clear session and re-authenticate
rm ~/tradebot-kite/data/trading-session.enc
pm2 restart nifty-trading-bot
```

**3. HTTPS/SSL Issues:**

```bash
# Check Nginx status
sudo systemctl status nginx

# Test SSL certificate
openssl s_client -connect 98.70.40.23:443 -servername 98.70.40.23

# Restart Nginx
sudo systemctl restart nginx
```

**4. Memory Issues:**

```bash
# Check memory usage
free -h
pm2 status

# Restart if high memory usage
pm2 restart nifty-trading-bot
```

### **Debug Mode Activation**

```bash
# Enable debug logging (if supported in your app)
export DEBUG=*
pm2 restart nifty-trading-bot --update-env

# Or check if app has debug environment variable
export NODE_ENV=development
pm2 restart nifty-trading-bot --update-env
```

---

## 📋 Log Management

### **PM2 Logs**

**View Real-time Logs:**

```bash
# All logs (stdout + stderr)
pm2 logs nifty-trading-bot

# Only error logs
pm2 logs nifty-trading-bot --err

# Only output logs
pm2 logs nifty-trading-bot --out

# Last N lines
pm2 logs nifty-trading-bot --lines 50

# Follow logs (real-time)
pm2 logs nifty-trading-bot --follow
```

**Log File Locations:**

```bash
# PM2 log directory
ls -la ~/.pm2/logs/

# Specific log files
tail -f ~/.pm2/logs/nifty-trading-bot-out.log
tail -f ~/.pm2/logs/nifty-trading-bot-error.log
```

### **Application-Specific Logs**

```bash
# Application log directory (if exists)
ls -la ~/tradebot-kite/logs/

# View trading logs
tail -f ~/tradebot-kite/logs/trading.log

# View error logs
tail -f ~/tradebot-kite/logs/error.log
```

### **System Logs**

```bash
# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# System logs
sudo journalctl -u nginx -f
sudo journalctl -u pm2-azureuser -f

# SSH connection logs
sudo tail -f /var/log/auth.log
```

### **Log Rotation & Cleanup**

```bash
# Clear PM2 logs
pm2 flush

# Rotate PM2 logs
pm2 install pm2-logrotate

# Check log sizes
du -sh ~/.pm2/logs/*
du -sh ~/tradebot-kite/logs/*
```

---

## 📊 System Monitoring

### **Resource Usage**

```bash
# CPU and Memory
htop
# Or basic version
top

# Memory details
free -h

# Disk usage
df -h

# Disk usage by directory
du -sh ~/* | sort -h

# Network connections
ss -tulnp
netstat -tulnp
```

### **Process Monitoring**

```bash
# All processes
ps aux | grep node
ps aux | grep nginx

# Process tree
pstree

# System load
uptime
cat /proc/loadavg
```

### **Network Monitoring**

```bash
# Active connections
ss -tulnp | grep :3000
ss -tulnp | grep :443

# Firewall status
sudo ufw status verbose

# Test external connectivity
curl -I https://98.70.40.23/health
```

### **Service Status**

```bash
# PM2 service
systemctl status pm2-azureuser

# Nginx service
sudo systemctl status nginx

# All services
systemctl list-units --type=service --state=running
```

---

## 🚀 Code Deployment

### **Deploy Latest Code from Local**

**From Windows PowerShell:**

```powershell
# Navigate to project directory
cd C:\Users\aabishek\repos\tradebot-kite\tradebot-kite

# Stop application
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23 "pm2 stop nifty-trading-bot"

# Transfer files
scp -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem -r src package.json tsconfig.json .env azureuser@98.70.40.23:~/tradebot-kite/

# SSH and rebuild
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23
```

**On VM after transfer:**

```bash
cd ~/tradebot-kite

# Remove problematic files if any
rm src/index_broken.ts 2>/dev/null || true

# Build application
npm run build

# Restart application
pm2 restart nifty-trading-bot

# Verify deployment
pm2 status
pm2 logs nifty-trading-bot --lines 10
```

### **Alternative: Zip Method**

```powershell
# Create zip file locally
Compress-Archive -Path src,package.json,tsconfig.json,.env -DestinationPath tradebot-kite-update.zip

# Transfer zip
scp -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem tradebot-kite-update.zip azureuser@98.70.40.23:~/

# SSH and extract
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23
```

**Extract on VM:**

```bash
# Stop application
pm2 stop nifty-trading-bot

# Extract files
cd ~/tradebot-kite
unzip -o ~/tradebot-kite-update.zip

# Build and restart
npm run build
pm2 restart nifty-trading-bot
```

### **Rollback Procedure**

```bash
# If deployment fails, rollback
cd ~/tradebot-kite

# Restore from git (if available)
git checkout HEAD -- .
npm run build
pm2 restart nifty-trading-bot

# Or restore from backup
cp -r ~/tradebot-kite-backup/* ~/tradebot-kite/
npm run build
pm2 restart nifty-trading-bot
```

---

## 🔒 SSL & HTTPS Management

### **Certificate Management**

```bash
# Check certificate expiry
echo | openssl s_client -connect 98.70.40.23:443 -servername 98.70.40.23 2>/dev/null | openssl x509 -noout -dates

# View certificate details
echo | openssl s_client -connect 98.70.40.23:443 -servername 98.70.40.23 2>/dev/null | openssl x509 -noout -text
```

### **Nginx SSL Configuration**

```bash
# Check Nginx configuration
sudo nginx -t

# View SSL configuration
sudo cat /etc/nginx/sites-available/nifty-trading-bot

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl status nginx
```

### **Regenerate SSL Certificate (If Needed)**

```bash
# Generate new self-signed certificate
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/nifty-trading-bot.key \
  -out /etc/ssl/certs/nifty-trading-bot.crt \
  -subj "/C=IN/ST=MH/L=Mumbai/O=NiftyTradingBot/CN=98.70.40.23"

# Restart Nginx
sudo systemctl restart nginx
```

### **HTTPS Testing**

```bash
# Test SSL connection
curl -k -v https://98.70.40.23/health

# Test redirect from HTTP
curl -I http://98.70.40.23/

# Check SSL rating (external tool)
curl -s "https://api.ssllabs.com/api/v3/analyze?host=98.70.40.23"
```

---

## 🚨 Emergency Procedures

### **Complete Application Failure**

```bash
# 1. Check system resources
free -h && df -h

# 2. Check if PM2 is running
ps aux | grep PM2

# 3. Restart PM2 daemon
pm2 kill
pm2 resurrect

# 4. If PM2 config lost, manual start
cd ~/tradebot-kite
pm2 start dist/index.js --name nifty-trading-bot
pm2 save
```

### **VM Unresponsive**

```powershell
# From Azure Portal:
# 1. Try "Restart" (soft restart)
# 2. If no response, "Stop" then "Start" (hard restart)
# 3. Check Azure service health dashboard
```

### **SSL/HTTPS Complete Failure**

```bash
# 1. Restart Nginx
sudo systemctl restart nginx

# 2. Check Nginx errors
sudo journalctl -u nginx --no-pager -l

# 3. Test configuration
sudo nginx -t

# 4. If all fails, temporary HTTP access
sudo systemctl stop nginx
# Then access via http://98.70.40.23:3000 (temporary)
```

### **Data Recovery**

```bash
# Backup important data
tar -czf ~/backup-$(date +%Y%m%d).tar.gz ~/tradebot-kite/data/ ~/.pm2/logs/

# Transfer backup to local
scp -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23:~/backup-*.tar.gz C:\Users\aabishek\Downloads\
```

### **Performance Issues**

```bash
# 1. Check system resources
htop

# 2. Check application memory
pm2 show nifty-trading-bot

# 3. Restart application
pm2 restart nifty-trading-bot

# 4. If persistent, restart VM from Azure Portal
```

---

## 💰 Cost Management

### **Current Cost Structure**

- **VM Type**: B2s (₹2,400/month if 24/7)
- **Storage**: 30GB Premium SSD (~₹400/month)
- **Network**: Minimal (~₹50/month)
- **Total 24/7**: ~₹2,850/month

### **Optimized Usage (60% Savings)**

- **Trading Hours**: 9 AM - 4:30 PM IST (7.5 hours/day)
- **Monthly Cost**: ~₹950/month
- **Savings**: ~₹1,900/month

### **Daily Cost Management**

```bash
# Check VM uptime
uptime

# View resource usage
free -h
df -h

# Estimate daily cost (B2s = ~₹80/day when running)
echo "VM running since: $(uptime -s)"
```

### **Auto-Shutdown Setup (Optional)**

```bash
# Create shutdown script
sudo tee /usr/local/bin/market-shutdown.sh > /dev/null << 'EOF'
#!/bin/bash
# Auto-shutdown after market hours
logger "Market hours ended - shutting down trading VM"
sudo shutdown -h now
EOF

# Make executable
sudo chmod +x /usr/local/bin/market-shutdown.sh

# Add to cron (4:30 PM IST weekdays)
crontab -e
# Add: 30 16 * * 1-5 /usr/local/bin/market-shutdown.sh
```

### **Cost Monitoring**

```bash
# Check Azure billing
# Azure Portal → Cost Management → Cost Analysis

# Monitor resource usage
# Azure Portal → Virtual Machines → nifty-trading-bot → Metrics
```

---

## 📞 Quick Reference Commands

**Essential Commands:**

```bash
# SSH Connection
ssh -i C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem azureuser@98.70.40.23

# Check Application Status
pm2 status

# View Logs
pm2 logs nifty-trading-bot --lines 20

# Restart Application
pm2 restart nifty-trading-bot

# Check System Resources
free -h && df -h

# Test HTTPS
curl -k https://98.70.40.23/health

# Emergency Stop
pm2 stop nifty-trading-bot
```

**URLs:**

- **Dashboard**: https://98.70.40.23
- **Health Check**: https://98.70.40.23/health
- **Authentication**: https://98.70.40.23/auth/login
- **Azure Portal**: https://portal.azure.com

---

## 📝 Notes & Best Practices

### **Security Best Practices**

1. Never share SSH private key
2. Keep .env file secure (contains API secrets)
3. Regularly check Azure security recommendations
4. Monitor login attempts in auth.log

### **Performance Best Practices**

1. Restart application daily during deployment
2. Monitor memory usage (restart if >200MB)
3. Clear logs weekly to save disk space
4. Use PM2 cluster mode for high load (if needed)

### **Backup Best Practices**

1. Weekly backup of trading data
2. Keep copy of working code locally
3. Document any manual configuration changes
4. Save PM2 configuration after changes

### **Cost Best Practices**

1. Stop VM promptly after market hours
2. Monitor Azure spending alerts
3. Use "Stop (deallocated)" not just "Stop"
4. Regular cleanup of logs and temporary files

---

**Document Version**: 1.0  
**Last Updated**: October 4, 2025  
**Created for**: NIFTY Trading Bot Azure VM Deployment  
**VM**: nifty-trading-bot (98.70.40.23)
