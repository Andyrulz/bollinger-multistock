# Manual Test for Option Price API Format

## Step-by-Step Testing Guide

### 1. First, let's understand what data we have available

**Test 1: Check what instrument data looks like**

```
GET http://localhost:3000/breakout-strategy/status
```

Look for `latest_breakout_signal` and note the format of instrument tokens.

### 2. Test the current instrument selection endpoint

**Test 2: Get instrument selection**

```
POST http://localhost:3000/execution/select-instrument
Content-Type: application/json

{
  "direction": "LONG",
  "niftyPrice": 25000
}
```

**Expected Response:**

```json
{
  "success": true,
  "instrument": {
    "instrument_token": 12345678,
    "tradingsymbol": "NIFTY25OCTCE25000",
    "name": "NIFTY",
    "exchange": "NFO",
    "strike": 25000,
    "expiry": "2025-10-31T15:30:00.000Z",
    "instrument_type": "CE",
    "lot_size": 75
  },
  "direction": "LONG",
  "underlying_price": 25000,
  "timestamp": "2025-10-01T..."
}
```

### 3. Test different quote formats with KiteConnect

Now we need to test what format works with `kiteConnect.getQuote()`:

**Test 3a: Using instrument token directly**

```
GET http://localhost:3000/debug/test-quote?format=token&value=12345678
```

**Test 3b: Using trading symbol**

```
GET http://localhost:3000/debug/test-quote?format=symbol&value=NIFTY25OCTCE25000
```

**Test 3c: Using NFO:symbol format**

```
GET http://localhost:3000/debug/test-quote?format=nfo&value=NFO:NIFTY25OCTCE25000
```

**Test 3d: Using exchange:token format**

```
GET http://localhost:3000/debug/test-quote?format=exchange_token&value=NFO:12345678
```

## Testing Commands (Using curl)

### Test 1: Check current strategy status

```bash
curl -H "Content-Type: application/json" http://localhost:3000/breakout-strategy/status
```

### Test 2: Get instrument selection

```bash
curl -X POST -H "Content-Type: application/json" -d '{"direction":"LONG","niftyPrice":25000}' http://localhost:3000/execution/select-instrument
```

### Test 3: Test quote formats (after we add debug endpoint)

```bash
curl "http://localhost:3000/debug/test-quote?format=token&value=REPLACE_WITH_ACTUAL_TOKEN"
curl "http://localhost:3000/debug/test-quote?format=symbol&value=REPLACE_WITH_ACTUAL_SYMBOL"
curl "http://localhost:3000/debug/test-quote?format=nfo&value=NFO:REPLACE_WITH_ACTUAL_SYMBOL"
```

## What to look for:

1. **In Test 1**: Find the exact structure of instrument data
2. **In Test 2**: Get a real instrument with real token and symbol
3. **In Test 3**: Find which format returns successful quotes

## Expected Behavior:

- One of the formats should return valid price data
- Others might return errors like "Invalid instrument" or similar
- Note which format works and we'll update the code accordingly

## After Testing:

Document which format works and we'll fix the `getOptionPriceByToken` method to use the correct format.
