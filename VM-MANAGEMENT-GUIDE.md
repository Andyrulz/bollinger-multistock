# Azure VM Management Guide - Trading Bot Multi-Strategy System

> **Production Environment**: Ubuntu 24.04.3 LTS | IP: 98.70.40.23 | Multi-Strategy Framework

## 📋 Table of Contents

- [VM Connection & Access](#-vm-connection--access)
- [Service Management (PM2)](#-service-management-pm2)
- [Strategy Management](#-strategy-management)
- [Independent Strategy Control](#-independent-strategy-control)
- [Monitoring & Health Checks](#-monitoring--health-checks)
- [Debugging & Troubleshooting](#-debugging--troubleshooting)
- [Log Management](#-log-management)
- [Backup & Recovery](#-backup--recovery)
- [Performance Monitoring](#-performance-monitoring)
- [Common Operations](#-common-operations)

---

## 🔐 VM Connection & Access

### **SSH Connection**

```bash
# Primary connection method
ssh -i ~/.ssh/azure-vm-key.pem azureuser@98.70.40.23

# Alternative with verbose output for troubleshooting
ssh -v -i ~/.ssh/azure-vm-key.pem azureuser@98.70.40.23

# Connection with port forwarding (if needed)
ssh -i ~/.ssh/azure-vm-key.pem -L 3000:localhost:3000 azureuser@98.70.40.23
```

### **Key File Management**

```bash
# Ensure proper permissions on key file
chmod 600 ~/.ssh/azure-vm-key.pem

# Verify key fingerprint
ssh-keygen -lf ~/.ssh/azure-vm-key.pem

# Add key to SSH agent (if using)
ssh-add ~/.ssh/azure-vm-key.pem
```

### **Initial VM Setup Verification**

```bash
# Check VM system info
uname -a
lsb_release -a

# Verify Node.js installation
node --version
npm --version

# Check PM2 installation
pm2 --version
```

---

## ⚙️ Service Management (PM2)

### **Main Service Control**

```bash
# Start the multi-strategy trading bot
pm2 start ecosystem.config.js --name trading-bot-multi-strategy

# Stop the service
pm2 stop trading-bot-multi-strategy

# Restart the service
pm2 restart trading-bot-multi-strategy

# Delete the service
pm2 delete trading-bot-multi-strategy

# Reload with zero downtime
pm2 reload trading-bot-multi-strategy
```

### **PM2 Status & Monitoring**

```bash
# View all processes
pm2 list

# Detailed status of specific service
pm2 show trading-bot-multi-strategy

# Real-time monitoring
pm2 monit

# View process logs
pm2 logs trading-bot-multi-strategy

# View only error logs
pm2 logs trading-bot-multi-strategy --err

# Follow logs in real-time
pm2 logs trading-bot-multi-strategy --lines 50 -f
```

### **PM2 Auto-Startup Configuration**

```bash
# Generate startup script
pm2 startup

# Save current process list
pm2 save

# Remove from startup
pm2 unstartup

# Manually start PM2 on boot
sudo systemctl enable pm2-azureuser
sudo systemctl start pm2-azureuser
```

---

## 🎯 Strategy Management

### **Multi-Strategy System Overview**

The VM runs a unified multi-strategy system with two distinct strategies:

1. **Breakout-Pullback Strategy** (Strategy 1) - Production Ready
2. **Bollinger Band Strategy** (Strategy 2) - Framework Ready

### **System Status Check**

```bash
# Check overall system health
curl http://localhost:3000/health

# Expected Response:
{
  "status": "OK",
  "timestamp": "2025-10-08T04:58:03.557Z"
}
```

### **Strategy Overview Endpoint**

```bash
# Get all strategies status
curl http://localhost:3000/strategies

# Expected Response:
{
  "success": true,
  "strategies": {
    "breakout-pullback-01": {
      "id": "breakout-pullback-01",
      "name": "NIFTY Breakout Pullback Strategy",
      "status": "ready",
      "isActive": false,
      "description": "Professional breakout-retracement strategy with pivot detection"
    },
    "bollinger-band-01": {
      "id": "bollinger-band-01",
      "name": "NIFTY Bollinger Band Strategy",
      "status": "ready",
      "isActive": false,
      "description": "Mean reversion strategy using Bollinger Bands with RSI confirmation"
    }
  }
}
```

---

## 🔄 Independent Strategy Control

### **Strategy 1: Breakout-Pullback Control**

#### **Start/Stop Strategy 1**

```bash
# Start Breakout-Pullback Strategy
curl -X POST http://localhost:3000/breakout-strategy/start

# Stop Breakout-Pullback Strategy
curl -X POST http://localhost:3000/breakout-strategy/stop

# Check Strategy 1 Status
curl http://localhost:3000/breakout-strategy/status
```

#### **Strategy 1 Specific Endpoints**

```bash
# Authentication status for Strategy 1
curl http://localhost:3000/auth/status

# Session persistence info
curl http://localhost:3000/auth/session-info

# Pivot levels
curl http://localhost:3000/breakout-strategy/pivots

# Memory optimization status
curl http://localhost:3000/breakout-strategy/memory-info

# Marking candle system status
curl http://localhost:3000/breakout-strategy/marking-candle

# Current trade setup
curl http://localhost:3000/breakout-strategy/trade-setup
```

#### **Strategy 1 Dashboard Access**

```bash
# V2 Dashboard (Recommended)
http://98.70.40.23:3000/breakout-strategy-v2

# Original Dashboard
http://98.70.40.23:3000/breakout-strategy

# Mobile-optimized view
http://98.70.40.23:3000/breakout-strategy-mobile
```

### **Strategy 2: Bollinger Band Control**

#### **Start/Stop Strategy 2**

```bash
# Start Bollinger Band Strategy
curl -X POST http://localhost:3000/bollinger-strategy/start

# Stop Bollinger Band Strategy
curl -X POST http://localhost:3000/bollinger-strategy/stop

# Check Strategy 2 Status
curl http://localhost:3000/bollinger-strategy/status
```

#### **Strategy 2 Specific Endpoints**

```bash
# Bollinger Band calculation status
curl http://localhost:3000/bollinger-strategy/bands

# RSI indicator status
curl http://localhost:3000/bollinger-strategy/rsi

# Signal history
curl http://localhost:3000/bollinger-strategy/signals

# Position status
curl http://localhost:3000/bollinger-strategy/position

# Risk metrics
curl http://localhost:3000/bollinger-strategy/risk-metrics
```

#### **Strategy 2 Dashboard Access**

```bash
# Bollinger Band Dashboard
http://98.70.40.23:3000/bollinger-strategy

# Technical indicators view
http://98.70.40.23:3000/bollinger-strategy/indicators

# Risk management panel
http://98.70.40.23:3000/bollinger-strategy/risk
```

### **Running Strategies Simultaneously**

```bash
# Start both strategies independently
curl -X POST http://localhost:3000/breakout-strategy/start
curl -X POST http://localhost:3000/bollinger-strategy/start

# Check both strategies are running
curl http://localhost:3000/strategies

# Stop both strategies
curl -X POST http://localhost:3000/breakout-strategy/stop
curl -X POST http://localhost:3000/bollinger-strategy/stop
```

### **Strategy-Specific Configuration**

#### **Strategy 1 Configuration**

```bash
# View current config
curl http://localhost:3000/breakout-strategy/config

# Update pivot lookback period
curl -X POST http://localhost:3000/breakout-strategy/config \
  -H "Content-Type: application/json" \
  -d '{"pivotLookback": 15, "volumePeriod": 50}'

# Reset to defaults
curl -X POST http://localhost:3000/breakout-strategy/config/reset
```

#### **Strategy 2 Configuration**

```bash
# View Bollinger Band settings
curl http://localhost:3000/bollinger-strategy/config

# Update band parameters
curl -X POST http://localhost:3000/bollinger-strategy/config \
  -H "Content-Type: application/json" \
  -d '{"period": 20, "stdDev": 2.0, "rsiPeriod": 14}'

# Reset to defaults
curl -X POST http://localhost:3000/bollinger-strategy/config/reset
```

---

## 🔍 Monitoring & Health Checks

### **System Health Monitoring**

```bash
# Overall system health
curl http://localhost:3000/health

# Detailed system metrics
curl http://localhost:3000/system/metrics

# Memory usage
curl http://localhost:3000/system/memory

# CPU usage
curl http://localhost:3000/system/cpu
```

### **Individual Strategy Health**

```bash
# Strategy 1 Health Check
curl http://localhost:3000/breakout-strategy/health

# Strategy 2 Health Check
curl http://localhost:3000/bollinger-strategy/health

# Authentication Health
curl http://localhost:3000/auth/health

# Database Connection Health
curl http://localhost:3000/database/health
```

### **Real-time Monitoring Commands**

```bash
# Watch system resources
htop

# Monitor network connections
netstat -tulpn | grep :3000

# Check disk usage
df -h

# Monitor memory usage
free -h

# Watch log files
tail -f ~/tradebot-kite/logs/trading.log
tail -f ~/tradebot-kite/logs/error.log
```

### **PM2 Real-time Monitoring**

```bash
# PM2 real-time dashboard
pm2 monit

# Watch resource usage
watch 'pm2 list'

# Monitor logs continuously
pm2 logs trading-bot-multi-strategy -f --lines 100
```

---

## 🐛 Debugging & Troubleshooting

### **Common Issues & Solutions**

#### **Issue 1: Service Won't Start**

```bash
# Check if port is already in use
sudo netstat -tulpn | grep :3000

# Kill any process using port 3000
sudo kill -9 $(sudo lsof -t -i:3000)

# Check PM2 status
pm2 status

# View error logs
pm2 logs trading-bot-multi-strategy --err

# Restart with fresh environment
pm2 delete trading-bot-multi-strategy
pm2 start ecosystem.config.js --name trading-bot-multi-strategy
```

#### **Issue 2: Authentication Failures**

```bash
# Check session persistence status
curl http://localhost:3000/auth/session-info

# Clear invalid session data
curl -X DELETE http://localhost:3000/auth/session

# Trigger re-authentication
curl http://localhost:3000/auth/login

# Check session file permissions
ls -la ~/tradebot-kite/data/
```

#### **Issue 3: Strategy Not Responding**

```bash
# Check strategy status
curl http://localhost:3000/breakout-strategy/status
curl http://localhost:3000/bollinger-strategy/status

# Restart specific strategy
curl -X POST http://localhost:3000/breakout-strategy/stop
curl -X POST http://localhost:3000/breakout-strategy/start

# Check for memory issues
curl http://localhost:3000/system/memory
```

#### **Issue 4: Data Not Updating**

```bash
# Check API connectivity
curl http://localhost:3000/breakout-strategy/test-api

# Verify market hours
curl http://localhost:3000/market/status

# Check historical data loading
curl http://localhost:3000/breakout-strategy/candles
```

### **Debug Mode Operations**

```bash
# Enable debug logging
export DEBUG=true
pm2 restart trading-bot-multi-strategy

# Run in development mode
NODE_ENV=development pm2 restart trading-bot-multi-strategy

# Enable verbose API logging
export LOG_LEVEL=debug
pm2 restart trading-bot-multi-strategy
```

### **Network Debugging**

```bash
# Test external API connectivity
curl -I https://api.kite.trade

# Check DNS resolution
nslookup api.kite.trade

# Test port accessibility
telnet localhost 3000

# Monitor network traffic
sudo tcpdump -i any port 3000
```

---

## 📊 Log Management

### **Log File Locations**

```bash
# Main log directory
cd ~/tradebot-kite/logs/

# View all log files
ls -la ~/tradebot-kite/logs/

# Expected files:
# - trading.log (main application logs)
# - error.log (error logs)
# - access.log (HTTP access logs)
# - strategy1.log (Strategy 1 specific logs)
# - strategy2.log (Strategy 2 specific logs)
```

### **Log Monitoring Commands**

```bash
# Follow all logs in real-time
tail -f ~/tradebot-kite/logs/*.log

# Follow specific strategy logs
tail -f ~/tradebot-kite/logs/trading.log | grep "breakout"
tail -f ~/tradebot-kite/logs/trading.log | grep "bollinger"

# Search for errors
grep -i error ~/tradebot-kite/logs/error.log | tail -20

# Filter logs by time
grep "$(date '+%Y-%m-%d')" ~/tradebot-kite/logs/trading.log

# Search for specific events
grep -i "pivot\|breakout\|signal" ~/tradebot-kite/logs/trading.log
```

### **Log Analysis & Filtering**

```bash
# Strategy 1 specific events
grep "BREAKOUT\|PIVOT\|marking" ~/tradebot-kite/logs/trading.log

# Strategy 2 specific events
grep "bollinger\|rsi\|band" ~/tradebot-kite/logs/trading.log

# Authentication events
grep -i "auth\|login\|session" ~/tradebot-kite/logs/trading.log

# Error analysis
grep -A 5 -B 5 "ERROR" ~/tradebot-kite/logs/error.log

# Performance metrics
grep "memory\|cpu\|performance" ~/tradebot-kite/logs/trading.log
```

### **Log Rotation & Cleanup**

```bash
# Archive old logs
tar -czf logs-$(date +%Y%m%d).tar.gz ~/tradebot-kite/logs/*.log

# Clear old logs (keep last 7 days)
find ~/tradebot-kite/logs/ -name "*.log" -mtime +7 -delete

# Monitor log sizes
du -sh ~/tradebot-kite/logs/*.log

# Rotate logs manually
pm2 flush trading-bot-multi-strategy
```

---

## 💾 Backup & Recovery

### **Session Data Backup**

```bash
# Create session backup
cp -r ~/tradebot-kite/data/ ~/backups/session-$(date +%Y%m%d)/

# Verify backup integrity
ls -la ~/backups/session-$(date +%Y%m%d)/

# Restore session data
sudo service pm2-azureuser stop
cp -r ~/backups/session-20251008/data/* ~/tradebot-kite/data/
sudo service pm2-azureuser start
```

### **Complete System Backup**

```bash
# Full application backup
tar -czf ~/backups/tradebot-full-$(date +%Y%m%d).tar.gz ~/tradebot-kite/

# Configuration backup
cp ~/tradebot-kite/ecosystem.config.js ~/backups/
cp ~/tradebot-kite/package.json ~/backups/

# PM2 configuration backup
pm2 save
cp ~/.pm2/dump.pm2 ~/backups/
```

### **Recovery Procedures**

```bash
# Emergency recovery - restore from backup
pm2 delete trading-bot-multi-strategy
tar -xzf ~/backups/tradebot-full-20251008.tar.gz -C ~/
cd ~/tradebot-kite
npm install
pm2 start ecosystem.config.js --name trading-bot-multi-strategy

# Session-only recovery
pm2 stop trading-bot-multi-strategy
rm -rf ~/tradebot-kite/data/*
cp -r ~/backups/session-20251008/data/* ~/tradebot-kite/data/
pm2 start trading-bot-multi-strategy
```

---

## 📈 Performance Monitoring

### **Resource Monitoring**

```bash
# CPU usage by process
top -p $(pgrep -f "trading-bot")

# Memory usage details
cat /proc/$(pgrep -f "trading-bot")/status | grep Vm

# Disk I/O monitoring
iotop -p $(pgrep -f "trading-bot")

# Network monitoring
nethogs -p $(pgrep -f "trading-bot")
```

### **Application Performance**

```bash
# Response time testing
time curl http://localhost:3000/health

# Load testing (basic)
for i in {1..10}; do curl -w "%{time_total}\n" -o /dev/null -s http://localhost:3000/health; done

# Memory leak detection
watch 'curl -s http://localhost:3000/system/memory | grep heap'

# API performance metrics
curl http://localhost:3000/metrics/performance
```

### **PM2 Performance Metrics**

```bash
# Detailed process metrics
pm2 show trading-bot-multi-strategy

# Reset process statistics
pm2 reset trading-bot-multi-strategy

# Monitor over time
pm2 logs trading-bot-multi-strategy --lines 0 -f | grep -E "(memory|cpu|performance)"
```

---

## 🔧 Common Operations

### **Daily Maintenance**

```bash
# Morning startup routine
ssh azureuser@98.70.40.23
pm2 status
curl http://localhost:3000/health
curl http://localhost:3000/auth/status

# Start trading (if needed)
curl -X POST http://localhost:3000/breakout-strategy/start

# Evening shutdown routine
curl -X POST http://localhost:3000/breakout-strategy/stop
curl -X POST http://localhost:3000/bollinger-strategy/stop
pm2 save
```

### **Weekly Maintenance**

```bash
# System updates
sudo apt update && sudo apt upgrade -y

# Log cleanup
find ~/tradebot-kite/logs/ -name "*.log" -mtime +7 -delete

# Backup creation
tar -czf ~/backups/weekly-backup-$(date +%Y%m%d).tar.gz ~/tradebot-kite/

# Restart services
pm2 restart all
```

### **Emergency Procedures**

```bash
# Complete system restart
sudo reboot

# Service-only restart
pm2 restart all

# Force kill and restart
pm2 delete all
pm2 start ecosystem.config.js --name trading-bot-multi-strategy

# Clear all data and restart fresh
pm2 stop trading-bot-multi-strategy
rm -rf ~/tradebot-kite/data/*
rm -rf ~/tradebot-kite/logs/*
pm2 start trading-bot-multi-strategy
```

### **Quick Status Check Script**

```bash
# Create a status check script
cat > ~/check-status.sh << 'EOF'
#!/bin/bash
echo "=== VM Trading Bot Status Check ==="
echo "Date: $(date)"
echo "=== PM2 Status ==="
pm2 list
echo "=== Service Health ==="
curl -s http://localhost:3000/health | jq '.'
echo "=== Strategy Status ==="
curl -s http://localhost:3000/strategies | jq '.'
echo "=== Authentication ==="
curl -s http://localhost:3000/auth/status | jq '.'
echo "=== System Resources ==="
free -h
df -h | grep -E "(/$|/home)"
echo "=== Recent Errors ==="
tail -5 ~/tradebot-kite/logs/error.log
EOF

chmod +x ~/check-status.sh

# Run status check
./check-status.sh
```

---

## 🎯 Strategy-Specific Operations

### **Strategy 1: Breakout-Pullback Operations**

```bash
# Quick Strategy 1 control
alias bb-start='curl -X POST http://localhost:3000/breakout-strategy/start'
alias bb-stop='curl -X POST http://localhost:3000/breakout-strategy/stop'
alias bb-status='curl http://localhost:3000/breakout-strategy/status'
alias bb-pivots='curl http://localhost:3000/breakout-strategy/pivots'

# Strategy 1 testing
curl -X POST http://localhost:3000/test/breakout-detection
curl -X POST http://localhost:3000/test/volume-sma50
curl -X POST http://localhost:3000/test/candle-building
```

### **Strategy 2: Bollinger Band Operations**

```bash
# Quick Strategy 2 control
alias bol-start='curl -X POST http://localhost:3000/bollinger-strategy/start'
alias bol-stop='curl -X POST http://localhost:3000/bollinger-strategy/stop'
alias bol-status='curl http://localhost:3000/bollinger-strategy/status'
alias bol-bands='curl http://localhost:3000/bollinger-strategy/bands'

# Strategy 2 testing
curl -X POST http://localhost:3000/test/bollinger-calculation
curl -X POST http://localhost:3000/test/rsi-calculation
curl -X POST http://localhost:3000/test/signal-generation
```

### **Multi-Strategy Coordination**

```bash
# Start both strategies in sequence
curl -X POST http://localhost:3000/breakout-strategy/start && \
curl -X POST http://localhost:3000/bollinger-strategy/start

# Check both strategies are running
curl http://localhost:3000/strategies | jq '.strategies | to_entries[] | {strategy: .key, active: .value.isActive}'

# Stop all strategies
curl -X POST http://localhost:3000/breakout-strategy/stop && \
curl -X POST http://localhost:3000/bollinger-strategy/stop
```

---

## 📱 Remote Access & Mobile Management

### **Mobile-Friendly Endpoints**

```bash
# Mobile dashboard access
http://98.70.40.23:3000/mobile/dashboard

# Quick status for mobile
curl http://98.70.40.23:3000/mobile/status

# Mobile-optimized controls
curl -X POST http://98.70.40.23:3000/mobile/start-strategy1
curl -X POST http://98.70.40.23:3000/mobile/stop-all
```

### **Remote Management Scripts**

```bash
# Create remote management aliases (run locally)
alias vm-status='ssh azureuser@98.70.40.23 "curl -s http://localhost:3000/health"'
alias vm-strategies='ssh azureuser@98.70.40.23 "curl -s http://localhost:3000/strategies"'
alias vm-start-bb='ssh azureuser@98.70.40.23 "curl -X POST http://localhost:3000/breakout-strategy/start"'
alias vm-stop-all='ssh azureuser@98.70.40.23 "curl -X POST http://localhost:3000/breakout-strategy/stop && curl -X POST http://localhost:3000/bollinger-strategy/stop"'
```

---

## 🚨 Emergency Contact & Support

### **Critical Issue Response**

```bash
# Emergency shutdown
ssh azureuser@98.70.40.23 "pm2 stop all"

# Emergency restart
ssh azureuser@98.70.40.23 "pm2 restart all"

# Emergency logs
ssh azureuser@98.70.40.23 "tail -100 ~/tradebot-kite/logs/error.log"

# Emergency backup
ssh azureuser@98.70.40.23 "tar -czf ~/emergency-backup-$(date +%Y%m%d-%H%M).tar.gz ~/tradebot-kite/"
```

### **Escalation Procedures**

1. **Level 1**: Restart individual strategy
2. **Level 2**: Restart PM2 service
3. **Level 3**: Full VM restart
4. **Level 4**: Restore from backup

---

This comprehensive VM Management Guide provides you with all the tools and commands needed to effectively manage your multi-strategy trading bot system on Azure VM, with particular emphasis on independent strategy control and monitoring.
