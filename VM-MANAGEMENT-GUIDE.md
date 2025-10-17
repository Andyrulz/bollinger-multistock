# VM Quick Reference - Trading Bot

**VM**: `98.70.40.23` | \*\*Statuscccurl http://localhost:3000/strategies | grep isActive

````-s http://localhost:3000/strategies | grep isActive
```-s http://localhost:3000/strategies | grep isActive
```Enhanced Position Sizing Deployed (Oct 8, 2025)

## Connection

```bash
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
````

## Service Control

```bash
pm2 status                                    # Check status
pm2 restart trading-bot-multi-strategy        # Restart service
pm2 logs trading-bot-multi-strategy          # View logs
pm2 logs trading-bot-multi-strategy --err    # Error logs only
```

## Health Checks

```bash
curl http://localhost:3000/health            # System health
curl http://localhost:3000/strategies        # Strategy status
curl http://localhost:3000/auth/status       # Auth status
```

## Strategy Control

```bash
# Start/Stop Strategy
curl -X POST http://localhost:3000/breakout-strategy/start
curl -X POST http://localhost:3000/breakout-strategy/stop
curl http://localhost:3000/breakout-strategy/status

# Dashboard Access
http://98.70.40.23:3000/breakout-strategy-v2
```

## Common Issues

### Service Won't Start

```bash
pm2 delete trading-bot-multi-strategy
pm2 start dist/index.js --name trading-bot-multi-strategy
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
echo "=== Status Check ==="
pm2 list
curl -s http://localhost:3000/health
```
