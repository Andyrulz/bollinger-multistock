param([switch]$FailOnError)

$ErrorActionPreference = 'Stop'
$Vm = '98.70.40.23'
$User = 'azureuser'
$Key = 'C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem'

if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }
$script = @'
set -u
failures=0
pass(){ echo "PASS $1"; }
fail(){ echo "FAIL $1"; failures=$((failures+1)); }
json_assert(){ url="$1"; expression="$2"; output=$(mktemp); code=$(curl -k -sS -o "$output" -w '%{http_code}' "$url" 2>/dev/null || true); if [ "$code" != 200 ]; then rm -f "$output"; return 1; fi; python3 -c "import json; d=json.load(open('$output')); assert $expression" >/dev/null 2>&1; result=$?; rm -f "$output"; return $result; }

bollinger=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((p['pm2_env']['status'] for p in d if p['name']=='trading-bot-bollinger'),'missing'))" 2>/dev/null)
swing=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((p['pm2_env']['status'] for p in d if p['name']=='trading-bot-swing'),'missing'))" 2>/dev/null)
[ "$bollinger" = online ] && pass 'Bollinger PM2 online' || fail "Bollinger PM2 status=$bollinger"
[ "$swing" = online ] && pass 'Swing PM2 online' || fail "Swing PM2 status=$swing"

json_assert http://127.0.0.1:3001/health "d.get('status')=='OK'" && pass 'Bollinger health' || fail 'Bollinger health'
json_assert http://127.0.0.1:3001/auth/status "d.get('authenticated') is True" && pass 'Bollinger authentication restored' || fail 'Bollinger authentication'
json_assert http://127.0.0.1:3003/health "d.get('status')=='OK' and d.get('authenticated') is True and d.get('tradingOperations') is False" && pass 'Gateway authenticated and read-only' || fail 'Gateway safety'
json_assert http://127.0.0.1:3003/auth/status "d.get('authenticated') is True" && pass 'Gateway session flow' || fail 'Gateway session flow'

instrument_file=$(mktemp)
instrument_code=$(curl -sS -o "$instrument_file" -w '%{http_code}' http://127.0.0.1:3003/instruments/NSE 2>/dev/null || true)
if [ "$instrument_code" = 200 ] && [ "$(wc -c < "$instrument_file")" -gt 1000 ]; then pass 'Gateway NSE instruments flow'; else fail 'Gateway NSE instruments flow'; fi
rm -f "$instrument_file"

json_assert http://127.0.0.1:3002/health "d.get('status')=='OK' and d.get('mode')=='SCANNER_ONLY' and d.get('tradingEnabled') is False" && pass 'Swing scanner-only health' || fail 'Swing health/safety'
json_assert http://127.0.0.1:3002/api/status "d.get('serviceStatus')=='ONLINE' and d.get('mode')=='SCANNER_ONLY' and d.get('tradingEnabled') is False and d.get('dataQuality',{}).get('integrity')=='ok'" && pass 'Swing database integrity' || fail 'Swing database integrity'
json_assert http://127.0.0.1:3002/api/config "len(d.get('presets',[]))==3" && pass 'Exactly three scanner profiles' || fail 'Scanner profiles'
json_assert http://127.0.0.1:3002/api/results/latest "d.get('tradingEnabled') is False" && pass 'Swing results flow' || fail 'Swing results flow'
json_assert http://127.0.0.1:3002/api/watchlists/status "isinstance(d.get('states'),dict)" && pass 'Swing watchlist flow' || fail 'Swing watchlist flow'

slots=$(mktemp)
slots_code=$(curl -sS -o "$slots" -w '%{http_code}' http://127.0.0.1:3001/api/slots 2>/dev/null || true)
active=$(python3 -c "import json; d=json.load(open('$slots')); x=d if isinstance(d,list) else d.get('slots',d.get('data',[])); print(sum(bool(i.get('hasActivePosition') or i.get('position')) for i in x))" 2>/dev/null || echo unknown)
[ "$slots_code" = 200 ] && pass "Bollinger slots reachable (active=$active)" || fail 'Bollinger slots flow'
rm -f "$slots"

[ "$(ss -ltnH 'sport = :3002' 2>/dev/null | awk '{print $4}' | grep -cv '^127\.0\.0\.1:3002$')" = 0 ] && [ -n "$(ss -ltnH 'sport = :3002' 2>/dev/null)" ] && pass 'Swing bound to loopback only' || fail 'Swing network binding'

public_code=$(curl -k -sS -o /tmp/swing-public.html -w '%{http_code}' https://127.0.0.1/tradebot-multistock/swing 2>/dev/null || true)
[ "$public_code" = 200 ] && grep -q 'Swing Trading Scanner' /tmp/swing-public.html && pass 'Nginx Swing dashboard route' || fail "Nginx Swing route code=$public_code"
rm -f /tmp/swing-public.html

for endpoint in status config results/latest watchlists/status; do
    json_assert "https://127.0.0.1/tradebot-multistock/api/swing/$endpoint" "True" && pass "Authenticated Swing proxy $endpoint" || fail "Authenticated Swing proxy $endpoint"
done

if grep -Eriq 'access[_ -]?token|api[_ -]?secret' /home/azureuser/swing-trading/logs 2>/dev/null; then fail 'Sensitive token pattern found in Swing logs'; else pass 'No token pattern in Swing logs'; fi

echo "SUMMARY failures=$failures"
exit "$failures"
'@
$normalized = $script.Replace("`r`n", "`n")
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($normalized))
$output = ssh -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no "$User@$Vm" "echo '$encoded' | base64 -d | bash" 2>&1
$exitCode = $LASTEXITCODE
$output | ForEach-Object {
    if ($_ -match '^PASS') { Write-Host $_ -ForegroundColor Green }
    elseif ($_ -match '^FAIL') { Write-Host $_ -ForegroundColor Red }
    else { Write-Host $_ }
}
if ($exitCode -ne 0 -and $FailOnError) { exit $exitCode }
exit $exitCode
