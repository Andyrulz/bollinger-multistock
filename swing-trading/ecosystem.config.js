const path = require('node:path');
const home = process.env.HOME || '/home/azureuser';

module.exports = {
  apps: [{
    name: 'trading-bot-swing',
    cwd: path.join(home, 'swing-trading'),
    script: 'start-production.sh',
    interpreter: '/bin/bash',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      SWING_NODE_BINARY: process.env.SWING_NODE_BINARY || path.join(home, 'opt/node-v20/bin/node'),
      SWING_HOST: '127.0.0.1',
      SWING_PORT: 3002,
      BROKER_DATA_GATEWAY_URL: 'http://127.0.0.1:3003',
      SWING_SCANNER_CONFIG: path.join(home, 'swing-trading/config/scanner.json'),
      SWING_MOMENTUM_DB: path.join(home, 'swing-trading/data/momentum.db'),
      SWING_MARKET_DB: path.join(home, 'swing-trading/data/swing-market-data.db'),
      SWING_OUTPUT_DIR: path.join(home, 'swing-trading/data/scans'),
      TZ: 'Asia/Kolkata'
    },
    error_file: path.join(home, 'swing-trading/logs/error.log'),
    out_file: path.join(home, 'swing-trading/logs/output.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true,
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    min_uptime: '30s',
    kill_timeout: 10000
  }]
};
