#!/bin/bash
# UI-only redeploy: just swap dist (no config change)
cd ~/tradebot-bollinger
TS=$(date +%Y%m%d-%H%M%S)
echo "=== UI redeploy @ $TS ==="
test -f dist-deploy.zip || { echo "ERR: zip missing"; exit 1; }
rm -rf dist-new && mkdir dist-new
unzip -q dist-deploy.zip -d dist-new
echo "  unzipped"
cp -a dist/data dist-new/data && echo "  preserved dist/data"
pm2 stop trading-bot-bollinger || true
mv dist "dist-old-$TS" && echo "  moved dist -> dist-old-$TS"
mv dist-new dist && echo "  installed new dist"
pm2 restart trading-bot-bollinger --update-env
rm -f dist-deploy.zip
sleep 8
echo "=== STATUS ==="
pm2 jlist | python3 -c "import json,sys; [print(p['name'], p['pm2_env']['status'], 'restarts:', p['pm2_env'].get('restart_time')) for p in json.load(sys.stdin) if 'bollinger' in p['name']]"
echo "=== Last 25 log lines ==="
tail -25 logs/output.log
