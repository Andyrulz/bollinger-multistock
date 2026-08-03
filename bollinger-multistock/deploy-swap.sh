#!/bin/bash
# Atomic, health-checked swap for trading-bot-bollinger.
# Runtime data, .env and strategy configuration remain outside dist and are never replaced.

set -u

cd ~/tradebot-bollinger

TS=$(date +%Y%m%d-%H%M%S)
echo "=== Deploy swap @ $TS ==="

# Verify staging asset and current production release.
test -f dist-deploy.zip || { echo "ERR: dist-deploy.zip missing"; exit 1; }
test -d dist || { echo "ERR: current dist missing"; exit 1; }
test -f data/auth/session.json || { echo "ERR: persisted session missing"; exit 1; }

# Always recreate staging and validate its entry point before stopping production.
rm -rf dist-new
mkdir -p dist-new
unzip -q dist-deploy.zip -d dist-new || { echo "ERR: unable to unpack candidate"; exit 1; }
test -f dist-new/index.js || { echo "ERR: candidate dist/index.js missing"; exit 1; }
echo "  unzipped and validated dist-new"

# Back up persistent runtime state without printing secrets.
mkdir -p "deploy-backups/$TS"
cp -a data/auth "deploy-backups/$TS/"
cp -a data/strategy "deploy-backups/$TS/" 2>/dev/null || true
cp -a config/strategies.json "deploy-backups/$TS/strategies.json"
if [ -d dist/data ]; then
  cp -a dist/data "deploy-backups/$TS/dist-data"
  rm -rf dist-new/data
  cp -a dist/data dist-new/data
  echo "  preserved compiled-runtime dist/data"
fi
echo "  persistent state backed up to deploy-backups/$TS"

# Stop bot
pm2 stop trading-bot-bollinger || echo "  (pm2 stop returned non-zero, continuing)"
stopped=$(pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((p['pm2_env']['status'] for p in d if p['name']=='trading-bot-bollinger'),'missing'))" 2>/dev/null || echo unknown)
[ "$stopped" = stopped ] || { echo "ERR: Bollinger did not stop cleanly (status=$stopped)"; exit 1; }
echo "  pm2 stopped and verified"

# Atomic code-only swap. Configuration and data are deliberately untouched.
mv dist "dist-old-$TS" || { echo "ERR: unable to preserve current dist"; exit 1; }
mv dist-new dist || {
  mv "dist-old-$TS" dist
  echo "ERR: unable to install candidate dist"
  exit 1
}

# Restart
pm2 restart trading-bot-bollinger --update-env
echo "  pm2 restart issued"

# Validate process, health, restored authentication, and read-only gateway.
healthy=false
for attempt in $(seq 1 20); do
  app_code=$(curl -sS -o /tmp/bollinger-health.json -w '%{http_code}' http://127.0.0.1:3001/health 2>/dev/null || true)
  auth_code=$(curl -sS -o /tmp/bollinger-auth.json -w '%{http_code}' http://127.0.0.1:3001/auth/status 2>/dev/null || true)
  gateway_code=$(curl -sS -o /tmp/bollinger-gateway.json -w '%{http_code}' http://127.0.0.1:3003/health 2>/dev/null || true)
  authenticated=$(python3 -c "import json; print(str(bool(json.load(open('/tmp/bollinger-auth.json')).get('authenticated'))).lower())" 2>/dev/null || echo false)
  readonly=$(python3 -c "import json; print(str(json.load(open('/tmp/bollinger-gateway.json')).get('tradingOperations') is False).lower())" 2>/dev/null || echo false)
  if [ "$app_code" = 200 ] && [ "$auth_code" = 200 ] && [ "$gateway_code" = 200 ] && [ "$authenticated" = true ] && [ "$readonly" = true ]; then
    healthy=true
    break
  fi
  sleep 1
done

rm -f /tmp/bollinger-health.json /tmp/bollinger-auth.json /tmp/bollinger-gateway.json

if [ "$healthy" != true ]; then
  echo "ERR: candidate failed health/auth/gateway validation; rolling back"
  pm2 stop trading-bot-bollinger || true
  mv dist "dist-failed-$TS"
  mv "dist-old-$TS" dist
  pm2 restart trading-bot-bollinger --update-env
  exit 1
fi

echo "  candidate health, authentication and read-only gateway verified"
rm -f dist-deploy.zip
pm2 save

# Wait + status
echo "=== PM2 STATUS ==="
pm2 jlist | python3 -c "import json,sys; [print(p['name'], p['pm2_env']['status'], 'uptime:', p['pm2_env'].get('pm_uptime'), 'restarts:', p['pm2_env'].get('restart_time')) for p in json.load(sys.stdin) if 'bollinger' in p['name']]"
echo "=== Tail output.log ==="
tail -40 ~/tradebot-bollinger/logs/output.log
echo "=== Recent errors ==="
tail -20 ~/tradebot-bollinger/logs/error.log
