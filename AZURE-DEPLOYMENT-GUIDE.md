# 🚀 Azure VM Deployment Guide - NIFTY Trading Bot

## 📋 Overview

This guide provides detailed steps to deploy your NIFTY Breakout-Retracement Trading Bot to Azure VM for 24/7 cloud-based trading operations.

## 🎯 Deployment Goals

- **Reliability**: 24/7 uptime during market hours
- **Independence**: No dependency on local PC
- **Cost-Effective**: Optimize Azure free credits (₹10,000)
- **Security**: Secure trading environment
- **Monitoring**: Easy access to logs and dashboard

---

## 📝 Pre-Deployment Checklist

### ✅ Requirements Verification

- [ ] Azure account with ₹10,000 free credits
- [ ] Zerodha API credentials (API Key, API Secret)
- [ ] Trading bot code tested locally
- [ ] Understanding of basic Linux commands
- [ ] GitHub account (for code repository)

### ✅ Local Preparation

1. **Test Bot Locally**

   ```bash
   cd tradebot-kite
   npm install
   npm run build
   npm run dev
   ```

   - Verify authentication works
   - Test breakout strategy dashboard
   - Confirm all features functional

2. **Prepare Environment Variables**

   ```env
   ZERODHA_API_KEY=your_api_key_here
   ZERODHA_API_SECRET=your_api_secret_here
   PORT=3000
   NODE_ENV=production
   ```

3. **Push Code to GitHub** (if not already done)
   ```bash
   git add .
   git commit -m "Prepare for Azure deployment"
   git push origin main
   ```

---

## 🌐 Azure VM Setup

### Step 1: Create Azure VM

#### 1.1 Login to Azure Portal

- Go to [https://portal.azure.com](https://portal.azure.com)
- Sign in with your Azure account

#### 1.2 Create Virtual Machine

1. **Navigate**: Azure Portal → Virtual Machines → Create → Azure virtual machine

2. **Basic Configuration**:

   ```
   Subscription: Your subscription
   Resource Group: Create new → "trading-bot-rg"
   Virtual machine name: "nifty-trading-bot"
   Region: "Central India" (lowest latency for Indian markets)
   Availability options: No infrastructure redundancy required
   Security type: Standard
   Image: Ubuntu Server 20.04 LTS - Gen2
   VM architecture: x64
   ```

3. **Size Selection**:

   ```
   Size: Standard B1s (1 vCPU, 1 GB memory)
   Cost: ~₹1,200/month
   Note: Sufficient for Node.js trading bot
   ```

4. **Administrator Account**:

   ```
   Authentication type: SSH public key
   Username: azureuser
   SSH public key source: Generate new key pair
   Key pair name: nifty-trading-bot-key
   ```

   **⚠️ IMPORTANT**: Download and save the private key file (.pem)

5. **Inbound Port Rules**:
   ```
   Public inbound ports: Allow selected ports
   Select inbound ports: SSH (22), HTTP (80), HTTPS (443)
   ```

#### 1.3 Networking Configuration

```
Virtual network: (new) trading-bot-rg-vnet
Subnet: (new) default (10.0.0.0/24)
Public IP: (new) nifty-trading-bot-ip
NIC network security group: Basic
Public inbound ports: SSH (22), HTTP (80), HTTPS (443)
```

#### 1.4 Management & Monitoring

```
Boot diagnostics: Enable with managed storage account
OS guest diagnostics: Disable (to save costs)
```

#### 1.5 Review and Create

- **Estimated Cost**: ₹1,200-1,500/month
- Click **"Create"**
- **Download Private Key** when prompted
- Wait 3-5 minutes for deployment

---

### Step 2: Initial VM Configuration

#### 2.1 Connect to VM

```bash
# Windows (PowerShell/WSL)
ssh -i path\to\nifty-trading-bot-key.pem azureuser@YOUR_VM_PUBLIC_IP

# Your actual command
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
```

#### 2.2 System Updates

```bash
# Update package lists
sudo apt update

# Upgrade all packages
sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git unzip software-properties-common
```

#### 2.3 Configure Firewall

```bash
# Enable UFW firewall
sudo ufw enable

# Allow SSH (22)
sudo ufw allow ssh

# Allow HTTP (80) and HTTPS (443)
sudo ufw allow http
sudo ufw allow https

# Allow custom port 3000 for trading bot
sudo ufw allow 3000

# Check firewall status
sudo ufw status
```

---

### Step 3: Node.js and Application Setup

#### 3.1 Install Node.js 18.x

```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Install Node.js and npm
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher
```

#### 3.2 Install Process Manager (PM2)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify PM2 installation
pm2 --version
```

#### 3.3 Clone Your Trading Bot

```bash
# Navigate to home directory
cd ~

# Clone your repository
git clone https://github.com/YOUR_USERNAME/tradebot-kite.git

# Navigate to project directory
cd tradebot-kite

# Install dependencies
npm install

# Build TypeScript
npm run build
```

#### 3.4 Configure Environment Variables

```bash
# Create production environment file
nano .env
```

**Add the following content**:

```env
ZERODHA_API_KEY=your_actual_api_key_here
ZERODHA_API_SECRET=your_actual_api_secret_here
PORT=3000
NODE_ENV=production
```

**Save and exit**: `Ctrl + X`, then `Y`, then `Enter`

---

### Step 4: Production Deployment

#### 4.1 Start Application with PM2

```bash
# Start the trading bot
pm2 start dist/index.js --name "nifty-trading-bot"

# Check if running
pm2 status

# View logs
pm2 logs nifty-trading-bot

# Monitor in real-time
pm2 monit
```

#### 4.2 Configure Auto-Start on Reboot

```bash
# Generate startup script
pm2 startup

# Follow the instructions shown (usually run a sudo command)
# Example: sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u azureuser --hp /home/azureuser

# Save current PM2 processes
pm2 save
```

#### 4.3 Test Application Access

```bash
# Check if application is responding
curl http://localhost:3000/health

# Should return: {"status":"OK","timestamp":"..."}
```

---

### Step 5: Configure Public Access

#### 5.1 Update Azure Network Security Group

1. **Azure Portal** → **Virtual machines** → **nifty-trading-bot**
2. **Settings** → **Networking** → **Add inbound port rule**
3. **Configure Rule**:
   ```
   Source: Any
   Source port ranges: *
   Destination: Any
   Service: Custom
   Destination port ranges: 3000
   Protocol: TCP
   Action: Allow
   Priority: 1010
   Name: Port_3000
   ```

#### 5.2 Test External Access

```bash
# From your local machine
curl http://YOUR_VM_PUBLIC_IP:3000/health

# Or open in browser
http://YOUR_VM_PUBLIC_IP:3000
```

---

### Step 6: SSL Configuration (Optional but Recommended)

#### 6.1 Install Nginx Reverse Proxy

```bash
# Install Nginx
sudo apt install -y nginx

# Create configuration
sudo nano /etc/nginx/sites-available/trading-bot
```

**Add configuration**:

```nginx
server {
    listen 80;
    server_name YOUR_VM_PUBLIC_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 6.2 Enable Nginx Configuration

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/trading-bot /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Enable auto-start
sudo systemctl enable nginx
```

---

## 🔧 Daily Operations

### Morning Routine (8:30 AM IST)

1. **Check VM Status**

   ```bash
   # SSH into VM
   ssh -i nifty-trading-bot-key.pem azureuser@YOUR_VM_IP

   # Check bot status
   pm2 status
   pm2 logs nifty-trading-bot --lines 50
   ```

2. **Authenticate with Zerodha**

   - Open browser: `http://YOUR_VM_IP/auth/login`
   - Complete Zerodha OAuth flow
   - Verify authentication: `http://YOUR_VM_IP/auth/status`

3. **Start Trading Strategy**
   - Access dashboard: `http://YOUR_VM_IP/breakout-strategy-v2`
   - Click "Start Strategy & Initialize"
   - Monitor live data and signals

### During Market Hours (9:15 AM - 3:30 PM IST)

- **Monitor Dashboard**: Keep `http://YOUR_VM_IP/breakout-strategy-v2` open
- **Check Logs**: `pm2 logs nifty-trading-bot --lines 20`
- **Health Check**: `http://YOUR_VM_IP/health`

### Evening Routine (After 3:30 PM IST)

- **Review Performance**: Check P&L and trade history
- **Stop Strategy** (optional): Click "Stop Strategy"
- **Review Logs**: Check for any errors or issues

---

## 💰 Cost Optimization

### Auto-Shutdown Configuration

```bash
# Create shutdown script
sudo nano /usr/local/bin/market-shutdown.sh
```

**Add content**:

```bash
#!/bin/bash
# Stop trading bot gracefully
su - azureuser -c "cd ~/tradebot-kite && pm2 stop nifty-trading-bot"

# Wait 30 seconds
sleep 30

# Shutdown VM
shutdown -h now
```

**Make executable and schedule**:

```bash
# Make script executable
sudo chmod +x /usr/local/bin/market-shutdown.sh

# Add to crontab (shutdown at 4:00 PM IST on weekdays)
sudo crontab -e

# Add this line:
0 16 * * 1-5 /usr/local/bin/market-shutdown.sh
```

### Cost Monitoring

- **B1s VM**: ~₹1,200/month
- **Bandwidth**: ~₹200/month (minimal usage)
- **Storage**: ~₹100/month (30GB SSD)
- **Total**: ~₹1,500/month
- **Credits Duration**: 6-7 months with ₹10,000

---

## 🔍 Monitoring and Maintenance

### PM2 Monitoring Commands

```bash
# View all processes
pm2 status

# View logs
pm2 logs nifty-trading-bot

# View real-time monitoring
pm2 monit

# Restart application
pm2 restart nifty-trading-bot

# Stop application
pm2 stop nifty-trading-bot

# View PM2 logs
pm2 logs pm2
```

### System Monitoring

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check CPU usage
top

# Check network connections
netstat -tulpn | grep :3000
```

### Log Management

```bash
# Configure PM2 log rotation
pm2 install pm2-logrotate

# Set log retention (keep 7 days)
pm2 set pm2-logrotate:retain 7

# Check log sizes
ls -lah ~/.pm2/logs/
```

---

## 🛡️ Security Best Practices

### SSH Security

```bash
# Change SSH port (optional)
sudo nano /etc/ssh/sshd_config

# Change line: Port 22 to Port 2222
# Restart SSH: sudo systemctl restart sshd
```

### Environment Security

```bash
# Set proper permissions on .env file
chmod 600 ~/tradebot-kite/.env

# Verify no sensitive data in logs
grep -r "API_SECRET\|API_KEY" ~/.pm2/logs/
```

### Regular Updates

```bash
# Weekly security updates
sudo apt update && sudo apt upgrade -y

# Update Node.js packages monthly
cd ~/tradebot-kite
npm audit fix
```

---

## 🚨 Troubleshooting

### Common Issues and Solutions

#### Application Won't Start

```bash
# Check logs
pm2 logs nifty-trading-bot --lines 50

# Check if port is in use
sudo netstat -tulpn | grep :3000

# Restart with verbose logging
pm2 restart nifty-trading-bot --log-type

# Check environment variables
pm2 show nifty-trading-bot
```

#### Authentication Issues

```bash
# Check .env file
cat ~/tradebot-kite/.env

# Test API credentials manually
curl -X POST "https://api.kite.trade/session/token" \
  -d "api_key=YOUR_API_KEY" \
  -d "request_token=TEST" \
  -d "checksum=TEST"
```

#### Memory Issues

```bash
# Check memory usage
free -h

# Restart PM2
pm2 restart all

# Clear logs if too large
pm2 flush
```

#### Network Issues

```bash
# Check firewall
sudo ufw status

# Test internal connectivity
curl http://localhost:3000/health

# Test external connectivity (from local machine)
curl http://YOUR_VM_IP:3000/health
```

---

## 📞 Support and Maintenance

### Regular Maintenance Schedule

#### Daily (Automated)

- [ ] VM health check
- [ ] Application status verification
- [ ] Log rotation

#### Weekly (Manual)

- [ ] Review performance metrics
- [ ] Check system updates
- [ ] Verify backup integrity
- [ ] Monitor cost usage

#### Monthly (Manual)

- [ ] Update Node.js dependencies
- [ ] Security patches
- [ ] Performance optimization
- [ ] Cost analysis

### Emergency Contacts

- **Azure Support**: Available through Azure Portal
- **Zerodha Support**: [https://support.zerodha.com](https://support.zerodha.com)

### Backup Strategy

```bash
# Weekly backup of trade data
tar -czf ~/trading-data-backup-$(date +%Y%m%d).tar.gz ~/tradebot-kite/data/

# Keep only last 4 backups
ls -t ~/trading-data-backup-*.tar.gz | tail -n +5 | xargs rm -f
```

---

## ✅ Deployment Checklist

### Pre-Deployment

- [ ] Azure account with credits verified
- [ ] Zerodha API credentials ready
- [ ] Code tested locally
- [ ] GitHub repository updated

### VM Setup

- [ ] Azure VM created (B1s, Ubuntu 20.04)
- [ ] SSH access configured
- [ ] Firewall rules set
- [ ] System updated

### Application Deployment

- [ ] Node.js 18.x installed
- [ ] PM2 installed and configured
- [ ] Code cloned and built
- [ ] Environment variables set
- [ ] Application started with PM2
- [ ] Auto-startup configured

### Security and Access

- [ ] Public access configured
- [ ] SSL/Nginx configured (optional)
- [ ] SSH security hardened
- [ ] File permissions set

### Testing and Verification

- [ ] Health endpoint accessible
- [ ] Authentication flow working
- [ ] Dashboard accessible
- [ ] Strategy starts successfully
- [ ] Logs monitoring functional

### Production Ready

- [ ] Cost optimization configured
- [ ] Monitoring alerts set
- [ ] Backup strategy implemented
- [ ] Documentation reviewed
- [ ] Emergency procedures tested

---

## 📋 Quick Reference

### Essential Commands

```bash
# SSH into VM
ssh -i nifty-trading-bot-key.pem azureuser@YOUR_VM_IP

# Check bot status
pm2 status

# View real-time logs
pm2 logs nifty-trading-bot --lines 50 --follow

# Restart bot
pm2 restart nifty-trading-bot

# System health
free -h && df -h && pm2 monit
```

### Important URLs

- **Main Dashboard**: `http://YOUR_VM_IP:3000`
- **Modern Dashboard**: `http://YOUR_VM_IP:3000/breakout-strategy-v2`
- **Health Check**: `http://YOUR_VM_IP:3000/health`
- **Auth Status**: `http://YOUR_VM_IP:3000/auth/status`

### VM Details Template

```
VM Name: nifty-trading-bot
Resource Group: trading-bot-rg
Location: Central India
Size: Standard B1s
OS: Ubuntu 20.04 LTS
Public IP: [YOUR_VM_IP]
SSH Key: nifty-trading-bot-key.pem
Username: azureuser
```

---

## 🎉 Congratulations!

Your NIFTY Trading Bot is now running 24/7 on Azure VM!

**Next Steps**:

1. Test the daily authentication flow
2. Monitor for a few days to ensure stability
3. Set up alerts for any issues
4. Optimize costs as needed

**Remember**: This setup gives you professional-grade infrastructure for reliable automated trading. The bot will run independently of your local machine, ensuring you never miss a trading opportunity due to PC issues.

---

_Last Updated: October 2025_
_Version: 1.0_
