# Mettre la boutique en ligne sur votre VPS OVH

Ce guide explique comment faire tourner la boutique sur votre VPS, à l'adresse <https://bijoux-de-bois.com>, avec le HTTPS. Comptez une trentaine de minutes la première fois. Ensuite, chaque mise à jour se fait en une commande, ou automatiquement à chaque envoi sur GitHub.

## Comment ça s'articule

- **GitHub** conserve le code du site et son historique.
- **Le VPS** récupère le code depuis GitHub et fait tourner le site 24 h/24.
- **Nginx** (installé sur le VPS) reçoit les visiteurs, gère le HTTPS et transmet à l'application.
- **Stripe** encaisse les paiements et renvoie le client sur votre site.

## Ce qu'il vous faut

1. Un VPS OVH sous **Debian 12** ou **Ubuntu 22.04 / 24.04** (ce sont les images proposées par défaut).
2. L'**adresse IP** du VPS et son accès SSH (OVH vous les a envoyés par e-mail à la création).
3. Le domaine **bijoux-de-bois.com**, géré dans votre espace client OVH.
4. Le code de la boutique sur **GitHub** (dépôt public, ou privé avec une clé de déploiement, voir plus bas).

## Avant de commencer : l'ancien site

Aujourd'hui, `bijoux-de-bois.com` pointe vers un **hébergement web mutualisé OVH** (adresse 213.186.33.19), et non vers le VPS. Cet hébergement fait tourner un ancien site WordPress qui affiche actuellement une erreur de base de données.

Pointer le domaine vers le VPS remplacera ce site. Si vous souhaitez récupérer des photos ou des textes de l'ancien site, faites-le avant la bascule : espace client OVH → **Hébergements** → votre hébergement → onglet **FTP-SSH** pour télécharger les fichiers (les photos WordPress sont dans `wp-content/uploads`). L'abonnement d'hébergement mutualisé pourra être résilié ensuite, il ne servira plus.

## Étape 1 : pointer le domaine vers le VPS

Dans l'espace client OVH : **Noms de domaine → bijoux-de-bois.com → Zone DNS**.

1. **Modifiez** l'enregistrement de type `A` dont le sous-domaine est vide : remplacez `213.186.33.19` par l'adresse IP du VPS.
2. **Modifiez** de la même façon l'enregistrement `A` du sous-domaine `www`.
3. **Supprimez** les deux enregistrements de type `AAAA` (adresse IPv6 de l'ancien hébergement). Sinon, une partie des visiteurs continuerait d'arriver sur l'ancien site.

La propagation prend de quelques minutes à quelques heures. Vérifiez depuis votre PC que la réponse affiche bien l'adresse IP du VPS :

```bash
nslookup bijoux-de-bois.com
```

## Étape 2 : se connecter au VPS

Depuis PowerShell sur Windows :

```bash
ssh root@ADRESSE_IP_DU_VPS
```

Sur les images Ubuntu d'OVH, l'utilisateur est parfois `ubuntu` (et `debian` sur Debian). Dans ce cas :

```bash
ssh ubuntu@ADRESSE_IP_DU_VPS
```

puis passez en administrateur :

```bash
sudo -i
```

## Étape 3 : lancer l'installation

Une seule commande installe tout (Node.js, Nginx, HTTPS, le service). Remplacez `COMPTE/DEPOT` par le nom de votre compte et de votre dépôt GitHub, et l'adresse e-mail par la vôtre :

```bash
curl -fsSL https://raw.githubusercontent.com/COMPTE/DEPOT/main/deploy/setup-vps.sh -o setup-vps.sh
```

```bash
REPO_URL=https://github.com/COMPTE/DEPOT.git LETSENCRYPT_EMAIL=vous@exemple.fr bash setup-vps.sh
```

L'adresse e-mail sert uniquement aux rappels de renouvellement du certificat HTTPS. Le domaine `bijoux-de-bois.com` est déjà réglé dans le script.

Le script peut être relancé sans risque s'il s'interrompt. Si le certificat HTTPS échoue, c'est presque toujours parce que le DNS n'a pas encore propagé : attendez un peu puis relancez :

```bash
certbot --nginx -d bijoux-de-bois.com -d www.bijoux-de-bois.com --redirect
```

## Étape 4 : renseigner la clé Stripe

```bash
nano /var/www/boutique/.env
```

Collez votre clé après `STRIPE_SECRET_KEY=`, enregistrez avec `Ctrl+O` puis `Entrée`, quittez avec `Ctrl+X`. Puis redémarrez :

```bash
systemctl restart boutique
```

Dans le Dashboard Stripe, l'URL du webhook à déclarer est `https://bijoux-de-bois.com/api/webhook` (voir le README).

## Étape 5 : vérifier

Ouvrez <https://bijoux-de-bois.com> dans votre navigateur. Sur le VPS, ces commandes aident à diagnostiquer :

```bash
systemctl status boutique
```

```bash
journalctl -u boutique -f
```

## Mettre à jour le site

### Manuellement

Après avoir envoyé vos modifications sur GitHub, sur le VPS :

```bash
bash /var/www/boutique/deploy/deploy.sh
```

### Automatiquement à chaque envoi sur GitHub

Le fichier `.github/workflows/deploy.yml` est déjà prêt. Il faut donner à GitHub une clé SSH pour se connecter au VPS.

1. Sur le VPS, créez une clé dédiée et autorisez-la :

   ```bash
   ssh-keygen -t ed25519 -f /root/.ssh/github-deploy -N "" -C github-deploy && cat /root/.ssh/github-deploy.pub >> /root/.ssh/authorized_keys && cat /root/.ssh/github-deploy
   ```

   La commande affiche la **clé privée** (de `-----BEGIN` à `-----END`). Copiez-la en entier.

2. Sur GitHub : **votre dépôt → Settings → Secrets and variables → Actions → New repository secret**. Créez trois secrets :

   | Nom | Valeur |
   |---|---|
   | `VPS_HOST` | l'adresse IP du VPS |
   | `VPS_USER` | `root` |
   | `VPS_SSH_KEY` | la clé privée copiée à l'étape 1 |

À partir de là, chaque envoi sur la branche `main` met le site à jour en une minute environ. L'onglet **Actions** du dépôt montre si tout s'est bien passé.

## Dépôt GitHub privé

Si votre dépôt est privé, le VPS ne peut pas le lire sans autorisation. Deux options :

- **Le plus simple** : rendre le dépôt public. Il ne contient aucun secret (le fichier `.env` n'est jamais envoyé sur GitHub).
- **Garder le privé** : sur le VPS, créez une clé avec `ssh-keygen -t ed25519 -f /home/boutique/.ssh/id_ed25519 -N ""` en tant qu'utilisateur `boutique`, ajoutez la clé publique dans **GitHub → dépôt → Settings → Deploy keys**, puis utilisez l'adresse SSH du dépôt (`git@github.com:COMPTE/DEPOT.git`) comme `REPO_URL`.

## Fichiers concernés

| Fichier | Rôle |
|---|---|
| `deploy/setup-vps.sh` | Installation initiale complète, à lancer une fois |
| `deploy/deploy.sh` | Mise à jour du site (récupère le code, redémarre) |
| `deploy/boutique.service` | Service système : le site démarre avec le serveur et redémarre seul en cas de plantage |
| `deploy/nginx.conf` | Configuration Nginx (HTTP vers l'application, HTTPS ajouté par Certbot) |
| `.github/workflows/deploy.yml` | Déploiement automatique depuis GitHub |

## En cas de problème

| Symptôme | Piste |
|---|---|
| Le site ne répond pas du tout | Le DNS pointe encore vers l'ancien hébergement, ou le pare-feu OVH (espace client → VPS → Firewall) bloque les ports 80 et 443 |
| L'ancien site WordPress s'affiche encore | Propagation DNS en cours, ou enregistrements `AAAA` non supprimés |
| « Certificat invalide » ou certbot échoue | Le DNS ne pointe pas encore vers le VPS, vérifiez avec `nslookup` |
| Page d'erreur 502 | L'application est arrêtée : `systemctl restart boutique` puis `journalctl -u boutique -n 50` |
| Le paiement reste en mode démonstration | La clé Stripe manque dans `/var/www/boutique/.env`, ou le service n'a pas été redémarré |
| Les images ne s'affichent pas sur la page Stripe | Normal avec les images SVG de démonstration ; utilisez des JPG ou PNG |
