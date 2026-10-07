#!/usr/bin/env bash
# Installe ou met à jour la boutique SUR LE VPS (utilisateur ubuntu).
# Relançable sans risque : il ne touche qu'à /var/www/boutique, au processus pm2 "boutique"
# et au site Nginx bijoux-de-bois.com. Les autres applications du serveur ne sont pas modifiées.
#
#   bash /var/www/boutique/deploy/vps-install.sh

set -euo pipefail

APP_DIR=/var/www/boutique
SITE=bijoux-de-bois.com
cd "$APP_DIR"

echo "== Dépendances =="
npm ci --omit=dev --no-audit --no-fund

echo "== Configuration (.env) =="
if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i 's#^PORT=.*#PORT=3020#; s#^BASE_URL=.*#BASE_URL=#' .env
  chmod 600 .env
  echo "Fichier .env créé. Pour activer les paiements : nano $APP_DIR/.env (clé Stripe), puis pm2 restart boutique"
else
  echo "Fichier .env conservé."
fi

echo "== Processus pm2 =="
if pm2 describe boutique >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.js --update-env >/dev/null
  echo "Boutique rechargée."
else
  pm2 start deploy/ecosystem.config.js >/dev/null
  echo "Boutique démarrée."
fi
pm2 save >/dev/null

echo "== Site Nginx =="
if [[ ! -f "/etc/nginx/sites-available/$SITE" ]]; then
  sudo cp deploy/nginx.conf "/etc/nginx/sites-available/$SITE"
  sudo ln -sf "/etc/nginx/sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"
  sudo nginx -t
  sudo systemctl reload nginx
  echo "Site Nginx créé."
else
  echo "Site Nginx déjà en place (non modifié)."
fi

sleep 1
echo "== Vérification =="
curl -s -o /dev/null -w "Application sur le port 3020 : HTTP %{http_code}\n" http://127.0.0.1:3020/api/config
pm2 list | grep -E "^│ (id|[0-9]+ +│ boutique)" || true
