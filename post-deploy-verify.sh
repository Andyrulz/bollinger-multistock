#!/bin/bash
cd ~/tradebot-bollinger
echo "=== POST-DEPLOY STATUS ==="
pm2 jlist | python3 -c "
import json, sys
for p in json.load(sys.stdin):
    if 'bollinger' not in p['name']: continue
    print(p['name'], p['pm2_env']['status'], 'pid:', p.get('pid'), 'restarts:', p['pm2_env'].get('restart_time'))
"
echo
echo "=== CONFIG FLAGS (new) ==="
grep -E 'liquidity|enablePullback|pullbackSlots|enableStaleBreakoutFilter' config/strategies.json
echo
echo "=== EXPERIMENTAL FLAGS LOADED (last 2) ==="
grep 'Experimental flags loaded' logs/output.log | tail -2
echo
echo "=== LIFECYCLE EVENTS SINCE RESTART ==="
grep -c 'SIGNAL_LIFECYCLE' logs/output.log 2>/dev/null
echo "(0 expected — market closed, no candle signals)"
echo
echo "=== RECENT ERRORS (since deploy) ==="
tail -10 logs/error.log
echo
echo "=== PM2 SAVE ==="
pm2 save 2>&1 | tail -2
