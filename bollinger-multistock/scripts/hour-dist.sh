#!/bin/bash
LOG=~/tradebot-bollinger/logs/output.log
echo "=== Arms / immediate entries by hour ==="
for h in 09 10 11 12 13 14 15; do
  n=$(grep -E 'signal ARMED|entry signal detected' "$LOG" | grep -cE "2026-..-..T${h}:")
  echo "  hour ${h}: $n"
done
echo ""
echo "=== Total DEPLOYs by hour ==="
for h in 09 10 11 12 13 14 15; do
  n=$(grep -E '🚀 DEPLOY' "$LOG" | grep -cE "2026-..-..T${h}:")
  echo "  hour ${h}: $n"
done
echo ""
echo "=== Post-14:00 DEPLOYs that NEVER had a signal/arm in same window ==="
# Per-deploy: extract symbol, then check if signal log exists in next ~30 min
grep -E '🚀 DEPLOY' "$LOG" | grep -E '2026-..-..T14:' | head -50 | while read -r line; do
  sym=$(echo "$line" | grep -oE 'DEPLOY: [A-Z0-9&-]+' | sed 's/DEPLOY: //')
  ts=$(echo "$line" | grep -oE '2026-[0-9-]+T14:[0-9:]+')
  echo "  $ts  $sym"
done
