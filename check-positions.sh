#!/bin/bash
curl -s http://localhost:3001/api/slots | python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d['slots']:
    print(f\"slot {s['slotNumber']}: {s['symbol']} hasActivePosition={s['hasActivePosition']}\")
"
