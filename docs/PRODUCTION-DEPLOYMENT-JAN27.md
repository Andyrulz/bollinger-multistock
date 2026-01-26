# 🚀 Local Testing Guide - January 27, 2026

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

### Step 2: Verify Build
```powershell
npx tsc --noEmit
```

---

## ☀️ MORNING (Before 9:00 AM)

### Step 3: Start the Bot
```powershell
cd C:\Users\aabishek\Documents\repo-local\tradebot-bollinger-multistock
npm run dev
```

### Step 4: Authenticate with Zerodha (CRITICAL - Before 9:15 AM)
1. Open browser: **http://localhost:3000/auth/login**
2. Complete Zerodha 2FA login
3. Verify: Dashboard shows "Authenticated ✅"

---

## 📊 MARKET HOURS (9:15 AM - 3:30 PM)

### Step 5: Monitor Pre-Market Data Fetch (9:00-9:15 AM)
Watch terminal for: `✅ Pre-market data cached successfully`

### Step 6: Watch Scanner Run (9:30:05 AM)
Watch terminal for:
- `🔍 Running market scanner...`
- `✅ {STOCK}: Strategy deployed`
- `📁 Slot 1: Using data file...`

### Step 7: Monitor Dashboard
- **URL**: http://localhost:3000/
- Check: Strategy status, positions, capital

---

## 🔧 Quick Reference

| Item | Value |
|------|-------|
| Dashboard | http://localhost:3000/ |
| Auth URL | http://localhost:3000/auth/login |
| Capital/Slot | ₹65,000 |
| Scanner Time | 09:30:05 AM |

---

## ⚠️ Important Notes

1. **Expiry Blocking is DISABLED** - Trading allowed on Jan 27 (expiry day)
   - Re-enable after today by uncommenting in `src/services/MarketScanner.ts` lines 110-113

2. **Keep Terminal Open** - Bot runs in foreground with `npm run dev`

3. **Zombie Position Guard is ACTIVE** - If bot crashes mid-position, it will:
   - Recover same-stock positions ✅
   - Purge cross-stock ghost positions ✅
   - Preserve capital for P&L continuity ✅

4. **Slot-Based Capital**:
   - Slot 1: ₹65,000 (bollinger-slot1.json)
   - Slot 2: ₹65,000 (bollinger-slot2.json)
   - Slot 3: ₹65,000 (bollinger-slot3.json)

---

## 🆘 Emergency Commands

### Stop the Bot
Press `Ctrl+C` in the terminal

### Check for Open Positions
```powershell
Get-Content src\data\bollinger-slot1.json
Get-Content src\data\bollinger-slot2.json
Get-Content src\data\bollinger-slot3.json
```

### Manual Position Check
Go to Zerodha Kite: https://kite.zerodha.com/positions

---

## ✅ Pre-Flight Checklist

- [ ] Test data cleaned (`Remove-Item src\data\bollinger-slot*.json`)
- [ ] Build verified (`npx tsc --noEmit`)
- [ ] Bot started (`npm run dev`)
- [ ] Zerodha authenticated (before 9:15 AM)
- [ ] Dashboard accessible (http://localhost:3000/)
- [ ] Terminal showing no errors

**Good luck! 🚀**
