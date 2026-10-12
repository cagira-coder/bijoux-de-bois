#!/usr/bin/env bash
# Envoie la boutique sur le VPS et la (re)démarre. À lancer DEPUIS VOTRE PC, dans Git Bash :
#
#   bash deploy/envoyer.sh
#
# Ce qui part : tout le projet sauf node_modules, .git, .env, et les données vivantes du VPS
# (catalogue géré depuis l'administration, photos envoyées, commandes, mot de passe).
# Utile tant que le dépôt GitHub n'est pas en place ; ensuite, un "git push" suffit.

set -euo pipefail

VPS="${VPS:-ubuntu@152.228.131.140}"
APP_DIR=/var/www/boutique
cd "$(dirname "$0")/.."

echo "== Envoi des fichiers vers $VPS =="
tar --exclude=./node_modules --exclude=./.git --exclude=./.env --exclude=./.claude \
    --exclude=./data/orders.json --exclude=./data/products.json --exclude=./data/admin.json --exclude=./data/categories.json \
    --exclude='./public/images/products/*.jpg' --exclude='./public/images/products/*.png' --exclude='./public/images/products/*.webp' \
    -czf - . \
  | ssh "$VPS" "mkdir -p $APP_DIR && tar -xzf - -C $APP_DIR"

echo "== Installation sur le VPS =="
ssh "$VPS" "bash $APP_DIR/deploy/vps-install.sh"

echo
echo "Terminé. Boutique : http://152.228.131.140 (puis https://bijoux-de-bois.com une fois le DNS basculé)"
