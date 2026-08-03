param(
    [switch]$SkipTests,
    [switch]$SkipBollinger,
    [switch]$ForceActivePositions
)

$ErrorActionPreference = 'Stop'
$Vm = '98.70.40.23'
$User = 'azureuser'
$Key = if ($env:TRADING_BOT_SSH_KEY) { $env:TRADING_BOT_SSH_KEY } else { 'C:\Users\aabishek\Downloads\nifty-trading-bot_key.pem' }
$Bollinger = $PSScriptRoot
$Workspace = Split-Path $Bollinger -Parent
$Swing = Join-Path $Workspace 'swing-trading'
$Artifacts = Join-Path $Bollinger '.deploy-artifacts'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$NodeVersion = '20.19.5'

function Invoke-Native([scriptblock]$Command, [string]$Failure) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Failure (exit $LASTEXITCODE)" }
}

function Invoke-Remote([string]$Script) {
    $normalized = $Script.Replace("`r`n", "`n")
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($normalized))
    $output = ssh -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no "$User@$Vm" "echo '$encoded' | base64 -d | bash" 2>&1
    if ($LASTEXITCODE -ne 0) { $output | Write-Host; throw "Remote command failed (exit $LASTEXITCODE)" }
    return $output
}

function Send-File([string]$Source, [string]$Destination) {
    & scp -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no $Source "${User}@${Vm}:$Destination"
    if ($LASTEXITCODE -ne 0) { throw "Transfer failed: $Source" }
}

Write-Host '=== Safe dual-application deployment ===' -ForegroundColor Cyan
if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }
if (-not (Test-Path (Join-Path $Swing 'data\momentum.db'))) { throw 'Swing bootstrap database is missing' }
New-Item -ItemType Directory -Force $Artifacts | Out-Null

Write-Host '[1/7] Local build and tests' -ForegroundColor Green
Push-Location $Bollinger
try {
    Invoke-Native { npm run build } 'Bollinger build failed'
    if (-not $SkipTests) { Invoke-Native { npm test -- --runInBand } 'Bollinger tests failed' }
} finally { Pop-Location }
Push-Location $Swing
try {
    Invoke-Native { npm run build } 'Swing build failed'
    if (-not $SkipTests) { Invoke-Native { npm test -- --runInBand } 'Swing tests failed' }
    $snapshot = Join-Path $Artifacts 'swing-market-data.db'
    $source = (Join-Path $Swing 'data\swing-market-data.db').Replace('\','/')
    $target = $snapshot.Replace('\','/')
    node -e "const D=require('better-sqlite3'); const d=new D('$source',{readonly:true}); d.backup('$target').then(()=>d.close()).catch(e=>{console.error(e.message);process.exit(1)})"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to snapshot Swing database' }
} finally { Pop-Location }

Write-Host '[2/7] Production safety preflight' -ForegroundColor Green
$force = if ($ForceActivePositions) { 'true' } else { 'false' }
$preflight = @'
set -e
[ "$(pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((p['pm2_env']['status'] for p in d if p['name']=='trading-bot-bollinger'),'missing'))")" = online ]
auth=$(curl -fsS http://127.0.0.1:3001/auth/status | python3 -c "import json,sys; print(str(bool(json.load(sys.stdin).get('authenticated'))).lower())")
[ "$auth" = true ]
active=$(curl -fsS http://127.0.0.1:3001/api/slots | python3 -c "import json,sys; d=json.load(sys.stdin); x=d if isinstance(d,list) else d.get('slots',d.get('data',[])); print(sum(bool(i.get('hasActivePosition') or i.get('position')) for i in x))")
if [ "$active" != 0 ] && [ '__FORCE__' != true ]; then echo "REFUSED: $active active positions"; exit 42; fi
[ -f /home/__USER__/tradebot-bollinger/data/auth/session.json ]
[ "$(stat -c '%a' /home/__USER__/tradebot-bollinger/data/auth/session.json)" = 600 ]
echo "PASS authenticated=true active_positions=$active session_mode=600"
'@.Replace('__FORCE__', $force).Replace('__USER__', $User)
Invoke-Remote $preflight | Write-Host

Write-Host '[3/7] Create immutable deployment artifacts' -ForegroundColor Green
$swingStage = Join-Path $Artifacts 'swing-stage'
Remove-Item $swingStage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $swingStage 'data'),(Join-Path $swingStage 'logs') | Out-Null
Copy-Item (Join-Path $Swing 'dist') $swingStage -Recurse
Copy-Item (Join-Path $Swing 'config') $swingStage -Recurse
Copy-Item (Join-Path $Swing 'package.json'),(Join-Path $Swing 'package-lock.json'),(Join-Path $Swing 'ecosystem.config.js'),(Join-Path $Swing 'start-production.sh') $swingStage
Copy-Item (Join-Path $Swing 'data\momentum.db') (Join-Path $swingStage 'data\momentum.db')
Copy-Item (Join-Path $Artifacts 'swing-market-data.db') (Join-Path $swingStage 'data\swing-market-data.db')
$swingArchive = Join-Path $Artifacts "swing-$Timestamp.tar.gz"
& tar -czf $swingArchive -C $swingStage .
if ($LASTEXITCODE -ne 0) { throw 'Unable to package Swing release' }
$bollingerArchive = Join-Path $Artifacts 'dist-deploy.zip'
Remove-Item $bollingerArchive -Force -ErrorAction SilentlyContinue
& tar -a -cf $bollingerArchive -C (Join-Path $Bollinger 'dist') .
if ($LASTEXITCODE -ne 0) { throw 'Unable to package portable Bollinger release' }

Write-Host '[4/7] Transfer and validate Swing candidate' -ForegroundColor Green
Send-File $swingArchive "/home/$User/swing-$Timestamp.tar.gz"
$installSwing = @'
set -e
NODE_ROOT=/home/__USER__/opt/node-v20
if [ ! -x "$NODE_ROOT/bin/node" ]; then
    mkdir -p /home/__USER__/opt /tmp/node20-install
  cd /tmp/node20-install
    curl -fsSLO https://nodejs.org/dist/v__NODE_VERSION__/node-v__NODE_VERSION__-linux-x64.tar.xz
    curl -fsSLO https://nodejs.org/dist/v__NODE_VERSION__/SHASUMS256.txt
    grep ' node-v__NODE_VERSION__-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
    tar -xJf node-v__NODE_VERSION__-linux-x64.tar.xz
    mv node-v__NODE_VERSION__-linux-x64 "$NODE_ROOT"
fi
test -x "$NODE_ROOT/bin/node"
stage=/home/__USER__/swing-stage-__TIMESTAMP__
rm -rf "$stage" && mkdir -p "$stage"
tar -xzf /home/__USER__/swing-__TIMESTAMP__.tar.gz -C "$stage"
cd "$stage"
PATH="$NODE_ROOT/bin:$PATH" npm ci --omit=dev 2>&1
SWING_SCANNER_CONFIG="$stage/config/scanner.json" SWING_MOMENTUM_DB="$stage/data/momentum.db" SWING_MARKET_DB="$stage/data/swing-market-data.db" "$NODE_ROOT/bin/node" dist/src/index.js qc >/tmp/swing-qc.json
python3 -c "import json; d=json.load(open('/tmp/swing-qc.json')); assert d['mode']=='SCANNER_ONLY' and d['tradingEnabled'] is False and d['database']['integrity']=='ok'"
SWING_HOST=127.0.0.1 SWING_PORT=3102 SWING_SCANNER_CONFIG="$stage/config/scanner.json" SWING_MOMENTUM_DB="$stage/data/momentum.db" SWING_MARKET_DB="$stage/data/swing-market-data.db" "$NODE_ROOT/bin/node" dist/src/index.js serve >/tmp/swing-candidate.log 2>&1 & pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3102/health >/tmp/swing-health.json 2>/dev/null && break; sleep 1; done
python3 -c "import json; d=json.load(open('/tmp/swing-health.json')); assert d['status']=='OK' and d['mode']=='SCANNER_ONLY' and d['tradingEnabled'] is False"
kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true; trap - EXIT
rm -f /tmp/swing-qc.json /tmp/swing-health.json /tmp/swing-candidate.log /home/__USER__/swing-__TIMESTAMP__.tar.gz
echo 'PASS Swing candidate QC and isolated health'
'@.Replace('__USER__', $User).Replace('__NODE_VERSION__', $NodeVersion).Replace('__TIMESTAMP__', $Timestamp)
Invoke-Remote $installSwing | Write-Host

Write-Host '[5/7] Activate Swing without touching Bollinger' -ForegroundColor Green
$activateSwing = @'
set -e
stage=/home/__USER__/swing-stage-__TIMESTAMP__
root=/home/__USER__/swing-trading
previous=/home/__USER__/swing-trading-old-__TIMESTAMP__
if [ -d "$root" ]; then
  pm2 stop trading-bot-swing >/dev/null 2>&1 || true
    if [ -d "$root/data" ]; then rm -rf "$stage/data"; cp -a "$root/data" "$stage/data"; fi
    mv "$root" "$previous"
fi
mv "$stage" "$root"
mkdir -p "$root/logs"
cd "$root"
pm2 delete trading-bot-swing >/dev/null 2>&1 || true
pm2 start ecosystem.config.js --only trading-bot-swing
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3002/health >/tmp/swing-live.json 2>/dev/null && break; sleep 1; done
if ! python3 -c "import json; d=json.load(open('/tmp/swing-live.json')); assert d['status']=='OK' and d['mode']=='SCANNER_ONLY' and d['tradingEnabled'] is False"; then
    pm2 delete trading-bot-swing >/dev/null 2>&1 || true
    mv "$root" "/home/__USER__/swing-trading-failed-__TIMESTAMP__"
    if [ -d "$previous" ]; then mv "$previous" "$root"; cd "$root"; pm2 start ecosystem.config.js --only trading-bot-swing || true; fi
    echo 'ERR: Swing activation failed and was rolled back'
    exit 1
fi
rm -f /tmp/swing-live.json
echo 'PASS Swing live on loopback:3002'
'@.Replace('__USER__', $User).Replace('__TIMESTAMP__', $Timestamp)
Invoke-Remote $activateSwing | Write-Host

if (-not $SkipBollinger) {
    Write-Host '[6/7] Atomic Bollinger code swap with automatic rollback' -ForegroundColor Green
    Send-File $bollingerArchive "/home/$User/tradebot-bollinger/dist-deploy.zip"
    Send-File (Join-Path $Bollinger 'deploy-swap.sh') "/home/$User/tradebot-bollinger/deploy-swap.sh"
    Invoke-Remote "set -e; chmod 700 /home/$User/tradebot-bollinger/deploy-swap.sh; bash /home/$User/tradebot-bollinger/deploy-swap.sh" | Write-Host
} else { Write-Host '[6/7] Bollinger swap skipped' -ForegroundColor Yellow }

Write-Host '[7/7] End-to-end production verification' -ForegroundColor Green
& (Join-Path $Bollinger 'verify-dual-app.ps1') -FailOnError
if ($LASTEXITCODE -ne 0) { throw 'Post-deployment verification failed' }
Invoke-Remote 'pm2 save >/dev/null; echo PASS PM2 state saved' | Write-Host
Write-Host 'DEPLOYMENT PASSED: Bollinger authenticated; Swing scanner-only; gateway read-only.' -ForegroundColor Green
