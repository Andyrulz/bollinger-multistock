#!/bin/bash
# Atomic swap + restart for trading-bot-bollinger
# Preserves dist/data/, backs up dist/ and config/strategies.json

cd ~/tradebot-bollinger

TS=$(date +%Y%m%d-%H%M%S)
echo "=== Deploy swap @ $TS ==="

# Verify staging assets present
test -f dist-deploy.zip || { echo "ERR: dist-deploy.zip missing"; exit 1; }
test -f config/strategies.json.new || { echo "ERR: strategies.json.new missing"; exit 1; }

# Unzip staging (dist-new should already exist from prior step)
if [ ! -d dist-new ] || [ -z "$(ls -A dist-new 2>/dev/null)" ]; then
  rm -rf dist-new
  mkdir -p dist-new
  unzip -q dist-deploy.zip -d dist-new
  echo "  unzipped to dist-new"
else
  echo "  dist-new already populated, skipping unzip"
fi

# Preserve runtime data
if [ -d dist/data ] && [ ! -d dist-new/data ]; then
  cp -a dist/data dist-new/data
  echo "  preserved dist/data ($(ls dist/data | wc -l) entries)"
elif [ -d dist-new/data ]; then
  echo "  dist-new/data already preserved"
else
  echo "  WARNING: no dist/data to preserve"
fi

# Stop bot
pm2 stop trading-bot-bollinger || echo "  (pm2 stop returned non-zero, continuing)"
echo "  pm2 stopped"

# Atomic swap
mv dist "dist-old-$TS" && echo "  moved dist -> dist-old-$TS"
mv dist-new dist && echo "  moved dist-new -> dist"

# Swap config
cp config/strategies.json "config/strategies.json.bak-$TS" && echo "  backed up old config"
mv config/strategies.json.new config/strategies.json && echo "  installed new config"

# Restart
pm2 restart trading-bot-bollinger --update-env
echo "  pm2 restart issued"

# Cleanup zip
rm -f dist-deploy.zip

# Wait + status
sleep 10
echo "=== PM2 STATUS ==="
pm2 jlist | python3 -c "import json,sys; [print(p['name'], p['pm2_env']['status'], 'uptime:', p['pm2_env'].get('pm_uptime'), 'restarts:', p['pm2_env'].get('restart_time')) for p in json.load(sys.stdin) if 'bollinger' in p['name']]"
echo "=== Tail output.log ==="
tail -40 ~/tradebot-bollinger/logs/output.log
echo "=== Recent errors ==="
tail -20 ~/tradebot-bollinger/logs/error.log
