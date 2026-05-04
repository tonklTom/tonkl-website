# Tonkl Testnet Deployment Guide

Deploy the Tonkl node + Tonkl website to a VPS for public testnet access.

## Prerequisites

- Ubuntu 22.04+ VPS (2 CPU, 4 GB RAM, 40 GB SSD minimum)
- Domain: `testnet.tonkl.com` with A record pointing to VPS IP
- SSH access as a user with sudo privileges

## 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y build-essential curl git nginx certbot python3-certbot-nginx \
    python3 python3-pip ufw

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Node.js 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Create Service Users

```bash
# Unprivileged users for each service (no login shell)
sudo useradd -r -s /usr/sbin/nologin -m -d /opt/obscura obscura
sudo useradd -r -s /usr/sbin/nologin -m -d /opt/tonkl tonkl
```

## 3. Deploy Tonkl Node

```bash
# Clone and build
sudo -u obscura git clone https://github.com/your-org/tonkl-node.git /opt/obscura/node
cd /opt/obscura/node
sudo -u obscura cargo build --release

# Create data directory
sudo -u obscura mkdir -p /opt/obscura/node/data

# Install systemd service
sudo cp deploy/obscura-node.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable obscura-node
sudo systemctl start obscura-node

# Verify
sudo systemctl status obscura-node
curl -s -X POST http://127.0.0.1:9100 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"get_status","params":[],"id":1}'
```

## 4. Deploy Tonkl Website

```bash
# Clone the website repo
sudo -u tonkl git clone https://github.com/your-org/tonkl-website.git /opt/tonkl/web
cd /opt/tonkl/web

# Install dependencies and build
sudo -u tonkl npm ci
sudo -u tonkl npm run build

# Create production env file
sudo -u tonkl cp .env.production.template .env.production.local
sudo -u tonkl nano .env.production.local
# Set:
#   TONKL_NODE_URL=http://127.0.0.1:9100
#   TONKL_WALLET_SCRIPT=           (empty — disable wallet CLI in prod)
#   NODE_ENV=production

# Install systemd service
sudo cp deploy/tonkl-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tonkl-web
sudo systemctl start tonkl-web

# Verify
curl -s http://127.0.0.1:3001/api/node | python3 -m json.tool
```

## 5. SSL + Nginx

```bash
# Get SSL certificate
sudo certbot certonly --nginx -d testnet.tonkl.com

# Install nginx config
sudo cp deploy/nginx-tonkl.conf /etc/nginx/sites-available/tonkl
sudo ln -sf /etc/nginx/sites-available/tonkl /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Firewall

```bash
sudo bash deploy/ufw-rules.sh
```

This opens ports 22 (SSH), 80 (HTTP redirect), 443 (HTTPS), and 9101 (P2P).
Port 9100 (node RPC) stays **closed** — all access goes through the nginx → Next.js API proxy with rate limiting and method whitelisting.

## 7. DNS

Add these records in your domain registrar (Cloudflare, Namecheap, etc.):

| Type | Name    | Value          | TTL  |
|------|---------|----------------|------|
| A    | testnet | YOUR_VPS_IP    | 300  |
| AAAA | testnet | YOUR_VPS_IPv6  | 300  |

## 8. Verify

```bash
# From your local machine
curl -s https://testnet.tonkl.com/api/node | python3 -m json.tool
# Should return: { "connected": true, "status": { "block_height": ... } }
```

Open `https://testnet.tonkl.com` in a browser — the wallet dashboard should show live chain data.

## Updating

```bash
# Update node
cd /opt/obscura/node
sudo -u obscura git pull
sudo -u obscura cargo build --release
sudo systemctl restart obscura-node

# Update website
cd /opt/tonkl/web
sudo -u tonkl git pull
sudo -u tonkl npm ci
sudo -u tonkl npm run build
sudo systemctl restart tonkl-web
```

## Monitoring

```bash
# Check service status
sudo systemctl status obscura-node tonkl-web

# View logs
sudo journalctl -u obscura-node -f
sudo journalctl -u tonkl-web -f

# Check node health
curl -s http://127.0.0.1:9100 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"get_status","params":[],"id":1}' | python3 -m json.tool
```

## Security Checklist

- [ ] Node RPC (port 9100) bound to 127.0.0.1 only — not exposed to internet
- [ ] UFW firewall enabled with only required ports open
- [ ] WALLET_SCRIPT empty in production (no CLI spawning on public server)
- [ ] SSL certificate installed and auto-renewing
- [ ] Nginx rate limiting configured (30 req/min API, 5 req/min faucet)
- [ ] Services run as unprivileged users (tonkl, tonkl)
- [ ] systemd sandboxing enabled (NoNewPrivileges, ProtectSystem, etc.)
- [ ] No sensitive data in error responses (audited in API routes)
- [ ] SSH key-only auth (disable password auth in /etc/ssh/sshd_config)
