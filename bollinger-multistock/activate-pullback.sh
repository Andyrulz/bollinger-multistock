#!/bin/bash
# Atomic config swap + restart — flips pullback ON for slot 3
cd ~/tradebot-bollinger
TS=$(date +%Y%m%d-%H%M%S)
echo "=== Activate pullback @ $TS ==="
test -f config/strategies.json.new || { echo "ERR: strategies.json.new missing"; exit 1; }

# Show before/after diff for the flags
echo "--- BEFORE ---"
grep -E 'enablePullbackEntry|pullbackSlots' config/strategies.json
echo "--- AFTER  ---"
grep -E 'enablePullbackEntry|pullbackSlots' config/strategies.json.new

# Backup + swap
cp config/strategies.json "config/strategies.json.bak-$TS" && echo "  backed up"
mv config/strategies.json.new config/strategies.json && echo "  installed new config"

# Restart bot (data dir & dist unchanged)
pm2 restart trading-bot-bollinger --update-env
echo "  pm2 restart issued"

sleep 8
echo "=== STATUS ==="
pm2 jlist | python3 -c "import json,sys; [print(p['name'], p['pm2_env']['status'], 'restarts:', p['pm2_env'].get('restart_time')) for p in json.load(sys.stdin) if 'bollinger' in p['name']]"
echo "=== Last 12 log lines ==="
tail -12 logs/output.log
echo "=== Recent errors (last 5) ==="
tail -5 logs/error.log
