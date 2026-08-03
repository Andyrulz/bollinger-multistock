#!/bin/bash
# HTTPS Setup for Trading Bot VM
# This sets up nginx as a reverse proxy with self-signed SSL certificate

echo "=== Setting up HTTPS Reverse Proxy ==="

# Install nginx if not already installed
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    sudo apt-get update
    sudo apt-get install -y nginx
fi

# Create self-signed SSL certificate
echo "Creating self-signed SSL certificate..."
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/tradebot.key \
    -out /etc/nginx/ssl/tradebot.crt \
    -subj "/C=IN/ST=State/L=City/O=TradingBot/CN=98.70.40.23"

# Create nginx configuration
echo "Creating nginx configuration..."
sudo tee /etc/nginx/sites-available/tradebot << 'EOF'
server {
    listen 443 ssl;
    server_name 98.70.40.23;

    ssl_certificate /etc/nginx/ssl/tradebot.crt;
    ssl_certificate_key /etc/nginx/ssl/tradebot.key;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name 98.70.40.23;
    return 301 https://$server_name$request_uri;
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/tradebot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
echo "Testing nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "Reloading nginx..."
    sudo systemctl enable nginx
    sudo systemctl restart nginx
    echo ""
    echo "✅ HTTPS proxy setup complete!"
    echo ""
    echo "Next steps:"
    echo "1. Update your Zerodha API app redirect URL to: https://98.70.40.23/auth/callback"
    echo "2. Set REDIRECT_URL in .env: REDIRECT_URL=https://98.70.40.23/auth/callback"
    echo "3. Restart PM2: pm2 restart ecosystem.config.js"
    echo ""
    echo "⚠️  Note: You're using a self-signed certificate. Your browser will show a security warning."
    echo "    Click 'Advanced' and 'Proceed' to continue."
else
    echo "❌ nginx configuration test failed"
    exit 1
fi
