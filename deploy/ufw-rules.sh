#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# UFW firewall rules for Tonkl testnet VPS
# ────────────────────────────────────────────────────────────────
# Run as root: sudo bash deploy/ufw-rules.sh

set -euo pipefail

echo "=== Tonkl Testnet Firewall Setup ==="

# Reset to defaults
ufw default deny incoming
ufw default allow outgoing

# SSH (change port if you use a non-standard one)
ufw allow 22/tcp comment "SSH"

# HTTP/HTTPS (nginx)
ufw allow 80/tcp comment "HTTP redirect"
ufw allow 443/tcp comment "HTTPS"

# P2P gossip port (for node-to-node communication)
ufw allow 9101/tcp comment "Tonkl P2P"

# IMPORTANT: Do NOT open port 9100 (node RPC).
# The node binds to 127.0.0.1:9100 — only accessible locally.
# All external access goes through nginx → Next.js → /api/node proxy.

# Enable
ufw --force enable
ufw status verbose

echo ""
echo "=== Firewall configured ==="
echo "Open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS), 9101 (P2P)"
echo "Blocked:    9100 (node RPC — local only via API proxy)"
