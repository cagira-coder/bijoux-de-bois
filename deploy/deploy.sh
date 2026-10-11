#!/usr/bin/env bash
# Mise à jour depuis GitHub, SUR LE VPS : récupère la dernière version puis relance l'installation.
# Lancé automatiquement par .github/workflows/deploy.yml, ou à la main :
#
#   bash /var/www/boutique/deploy/deploy.sh

set -euo pipefail

APP_DIR=/var/www/boutique

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Le dossier $APP_DIR n'est pas relié à GitHub (pas de .git)."
  echo "Utilisez deploy/envoyer.sh depuis votre PC, ou clonez d'abord le dépôt dans $APP_DIR."
  exit 1
fi

echo "== Récupération du code =="
git -C "$APP_DIR" pull --ff-only origin main

bash "$APP_DIR/deploy/vps-install.sh"
