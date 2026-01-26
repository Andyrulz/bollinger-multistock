# 🚀 Production Deployment Guide - January 27, 2026

## Current Status
- **Expiry Blocking**: DISABLED (for Jan 27 expiry day testing)
- **Capital per Slot**: ₹65,000 × 3 slots = ₹1,95,000 total
- **Scanner Time**: 09:30:05 AM IST

---

## 🌙 TONIGHT (Before Sleep)

### Step 1: Clean Local Test Data
```powershell
cd C:\Users\aabishek\Documents\repo-local\tradebot-bollinger-multistock
Remove-Item src\data\bollinger-slot*.json -ErrorAction SilentlyContinue
```

### Step 2: Deploy to Azure VM
```powershell
.\deploy-to-vm.ps1
```

### Step 3: Copy .env (if needed)
```powershell
scp -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" .env azureuser@98.70.40.23:~/tradebot-kite/
```

### Step 4: Verify Deployment
```powershell
.\verify-deployment.ps1
```

### Step 5: Clean VM Test Data
```powershell
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23 "rm -f ~/tradebot-kite/src/data/bollinger-slot*.json"
```

---

## ☀️ MORNING (Before 9:00 AM)

### Step 6: SSH to VM & Check Bot Status
```powershell
ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23
pm2 status
pm2 logs trading-bot-multi-strategy --lines 20
```

### Step 7: Authenticate with Zerodha (CRITICAL - Before 9:15 AM)
1. Open browser: **http://98.70.40.23:3000/auth/login**
2. Complete Zerodha 2FA login
3. Verify: Dashboard shows "Authenticated ✅"

---

## 📊 MARKET HOURS (9:15 AM - 3:30 PM)

### Step 8: Monitor Pre-Market Data Fetch (9:00-9:15 AM)
```bash
# On VM
pm2 logs trading-bot-multi-strategy --lines 50
```
Look for: `✅ Pre-market data cached successfully`

### Step 9: Watch Scanner Run (9:30:05 AM)
```bash
pm2 logs trading-bot-multi-strategy --lines 100
```
Look for:
- `🔍 Running market scanner...`
- `✅ {STOCK}: Strategy deployed`
- `📁 Slot 1: Using data file...`

### Step 10: Monitor Dashboard
- **URL**: http://98.70.40.23:3000/
- Check: Strategy status, positions, capital

---

## 🔧 Quick Commands Reference

| Action | Command |
|--------|---------|
| SSH to VM | `ssh -i "C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem" azureuser@98.70.40.23` |
| Check status | `pm2 status` |
| View logs | `pm2 logs trading-bot-multi-strategy --lines 100` |
| Restart bot | `pm2 restart trading-bot-multi-strategy` |
| Stop bot | `pm2 stop trading-bot-multi-strategy` |
| Dashboard | http://98.70.40.23:3000/ |
| Auth URL | http://98.70.40.23:3000/auth/login |

---

## ⚠️ Important Notes

1. **Expiry Blocking is DISABLED** - Trading allowed on Jan 27 (expiry day)
   - Re-enable after today by uncommenting in `src/services/MarketScanner.ts` lines 110-113

2. **Zombie Position Guard is ACTIVE** - If bot crashes mid-position, it will:
   - Recover same-stock positions ✅
   - Purge cross-stock ghost positions ✅
   - Preserve capital for P&L continuity ✅

3. **InstrumentCache is ACTIVE** - NFO instruments cached to disk (no 15MB API spam)

4. **Slot-Based Capital**:
   - Slot 1: ₹65,000 (bollinger-slot1.json)
   - Slot 2: ₹65,000 (bollinger-slot2.json)
   - Slot 3: ₹65,000 (bollinger-slot3.json)

---

## 🆘 Emergency Commands

### Force Stop All Trading
```bash
pm2 stop trading-bot-multi-strategy
```

### Check for Open Positions
```bash
# View current strategy state
cat ~/tradebot-kite/src/data/bollinger-slot1.json
cat ~/tradebot-kite/src/data/bollinger-slot2.json
cat ~/tradebot-kite/src/data/bollinger-slot3.json
```

### Manual Position Check
Go to Zerodha Kite: https://kite.zerodha.com/positions

---

## ✅ Pre-Flight Checklist

- [ ] Test data cleaned (local + VM)
- [ ] Code deployed to VM
- [ ] .env file present on VM
- [ ] PM2 running
- [ ] Zerodha authenticated (before 9:15 AM)
- [ ] Dashboard accessible
- [ ] Logs showing no errors

**Good luck! 🚀**
