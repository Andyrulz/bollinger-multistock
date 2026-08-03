module.exports = {
  apps: [
    {
      name: 'trading-bot-bollinger',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        BASE_PATH: '/tradebot-multistock',
        BROKER_DATA_GATEWAY_PORT: 3003,
        SWING_SERVICE_URL: 'http://127.0.0.1:3002',
        TZ: 'Asia/Kolkata'
      },
      error_file: 'logs/error.log',
      out_file: 'logs/output.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      
      // Auto-restart on crashes
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 5000,
      shutdown_with_message: true,
      
      // Environment file
      env_file: '.env'
    },
    {
      name: 'trading-bot-swing',
      cwd: '../swing-trading',
      script: 'dist/src/index.js',
      args: 'serve',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        SWING_HOST: '127.0.0.1',
        SWING_PORT: 3002,
        BROKER_DATA_GATEWAY_URL: 'http://127.0.0.1:3003',
        TZ: 'Asia/Kolkata'
      },
      error_file: 'logs/error.log',
      out_file: 'logs/output.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000
    }
  ],

  deploy: {
    production: {
      user: 'azureuser',
      host: '98.70.40.23',
      ref: 'origin/main',
      repo: 'git@github.com:Andyrulz/tradebot-bollinger-multistock.git',
      path: '~/tradebot-bollinger',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production && pm2 save'
    }
  }
};
