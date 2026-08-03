# VM Quick Reference - Trading Bot

**VM**: `98.70.40.23` | **Timezone**: IST (Asia/Kolkata) | **Auto-Shutdown**: 4:30 PM Daily

Zerodha Login: https://98.70.40.23/

**Latest Deployment**: January 6, 2026 - Multi-Strategy System, AutoStart Enabled, PM2 Auto-Recovery Configured

**HTTPS Status**: Requires nginx reverse proxy setup for Zerodha OAuth (see HTTPS Setup section below)

## Connection

```bash
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
```

## Daily Operations (Auto-Shutdown at 4:30 PM)

### Morning Startup (After 9:00 AM)

```bash
# VM will auto-start the trading bot via PM2
# Just verify everything is running:
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
pm2 status
curl -s http://localhost:3000/health

# If strategies need manual start (check autoStart setting):
curl -s http://localhost:3000/strategies | grep "isActive"
```

### Pre-Shutdown Check (Before 4:30 PM)

```bash
# Check if any active trades before shutdown
curl -s http://localhost:3000/strategies | grep -E "isActive|totalTrades"
pm2 logs trading-bot-multi-strategy --lines 20 | grep -E "trade|position|error"
```

## Service Control

```bash
pm2 status                                    # Check status
pm2 restart trading-bot-multi-strategy        # Restart service
pm2 reload trading-bot-multi-strategy         # Reload service (graceful restart)
pm2 logs trading-bot-multi-strategy          # View logs
pm2 logs trading-bot-multi-strategy --err    # Error logs only
```

## Proper Restart (With Environment Variables)

```bash
# Full restart with environment reload
cd ~/tradebot-kite
pm2 stop trading-bot-multi-strategy
pm2 delete trading-bot-multi-strategy
pm2 start ecosystem.config.js
pm2 save

# Quick restart (if ecosystem.config.js exists)
cd ~/tradebot-kite
pm2 restart ecosystem.config.js
```

## Health Checks

```bash
curl http://localhost:3000/health            # System health
curl http://localhost:3000/strategies        # Strategy status
curl http://localhost:3000/auth/status       # Auth status
```

## Strategy Control

```bash
# Multi-Strategy Dashboard (Main)
http://98.70.40.23:3000/

# View all strategies status
curl -s http://localhost:3000/strategies

# Individual strategy control (via dashboard or API)
# Current strategies:
# - 1min Breakout Pullback Option Buy
# - 5m Bollinger Band Strategy

# Check specific strategy health
curl -s http://localhost:3000/strategies | grep -A 10 "name"
```

## Common Issues

### Service Won't Start

```bash
# Clean restart with environment variables
cd ~/tradebot-kite
pm2 delete trading-bot-multi-strategy
pm2 start ecosystem.config.js
pm2 save

# Alternative if ecosystem.config.js doesn't exist
pm2 delete trading-bot-multi-strategy
pm2 start dist/index.js --name trading-bot-multi-strategy
```

### Environment Variables Not Loading

```bash
# Verify .env file exists
cd ~/tradebot-kite && cat .env

# Check if ecosystem.config.js exists
ls -la ecosystem.config.js

# Restart with proper environment loading
pm2 delete trading-bot-multi-strategy
pm2 start ecosystem.config.js
```

### Authentication Error

```bash
curl http://localhost:3000/auth/login        # Re-authenticate
```

### Check Logs for Errors

```bash
tail -f ~/tradebot-kite/logs/error.log       # Follow error logs
grep -i error ~/tradebot-kite/logs/trading.log | tail -10
```

### System Resources

```bash
free -h                                      # Memory usage
df -h                                        # Disk usage
htop                                         # Process monitor
```

## Quick Status Script

```bash
echo "=== Daily Status Check ==="
echo "VM Time: $(date)"
echo "--- PM2 Status ---"
pm2 list
echo "--- Health Check ---"
curl -s http://localhost:3000/health
echo "--- Strategy Status ---"
curl -s http://localhost:3000/strategies | grep -o '"isActive":[^,]*' | head -2
echo "--- Recent Activity ---"
pm2 logs trading-bot-multi-strategy --lines 5 | tail -3
```

## Auto-Recovery & Monitoring

### HTTPS Setup (Required for Zerodha OAuth)

Zerodha requires HTTPS callback URLs. Set up nginx as a reverse proxy:

```bash
# On VM: Upload and run the setup script
scp -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" setup-https-proxy.sh azureuser@98.70.40.23:~/
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
chmod +x setup-https-proxy.sh
./setup-https-proxy.sh

# After setup:
# 1. Update Zerodha API app redirect URL to: https://98.70.40.23/auth/callback
#    Go to: https://developers.kite.trade/apps
# 2. Update .env file:
echo 'REDIRECT_URL=https://98.70.40.23/auth/callback' >> ~/tradebot-kite/.env
# 3. Restart PM2:
pm2 restart ecosystem.config.js

# Access via HTTPS:
https://98.70.40.23/
https://98.70.40.23/auth/login
```

**Note**: Self-signed certificate will show browser warning - click "Advanced" → "Proceed" to continue.

### PM2 Auto-Start (Configured)

- ✅ **PM2 will automatically start** the trading bot when VM restarts
- ✅ **Ecosystem config** loads all environment variables
- ✅ **Health monitoring** resumes automatically
- ✅ **AutoStart strategies** will activate if market is open

### Manual Verification After VM Restart

```bash
# Complete verification script
echo "=== Post-Restart Verification ==="
echo "1. VM Timezone: $(timedatectl | grep 'Time zone')"
echo "2. PM2 Status:"
pm2 status
echo "3. App Health:"
curl -s http://localhost:3000/health
echo "4. Auth Status:"
curl -s http://localhost:3000/auth/status 2>/dev/null || echo "Needs authentication"
echo "5. Strategies:"
curl -s http://localhost:3000/strategies | grep -E '"isActive":[^,]*|"healthStatus":[^,]*' | head -4
```

### Troubleshooting Auto-Start Issues

```bash
# If PM2 didn't auto-start after VM restart:
sudo systemctl status pm2-azureuser
sudo systemctl start pm2-azureuser
pm2 resurrect

# If app is running but not authenticated:
curl http://localhost:3000/auth/login

# If strategies are not auto-starting:
# Check config: autoStart should be true
curl -s http://localhost:3000/ | grep autoStart
```
