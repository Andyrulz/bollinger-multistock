#!/bin/bash
# QC check for deployed bot state
for i in 1 2 3; do
  f="/home/azureuser/tradebot-bollinger/dist/data/bollinger-slot$i.json"
  echo "=== Slot $i ==="
  python3 << EOF
import json
d = json.load(open("$f"))
print(f"  Capital: Rs {d.get('capital', 0):,.0f}")
print(f"  Trades : {len(d.get('tradeHistory', []))}")
print(f"  Active pos: {d.get('activePosition') is not None}")
EOF
done
