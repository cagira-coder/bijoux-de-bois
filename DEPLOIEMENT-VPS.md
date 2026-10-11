# Mise en ligne sur le VPS OVH (bijoux-de-bois.com)

## Où en est-on

| Élément | État |
|---|---|
| Serveur | VPS OVH `152.228.131.140` (Ubuntu), utilisateur `ubuntu` |
| Emplacement du site | `/var/www/boutique` |
| Processus | pm2, nom `boutique`, port interne 3020 (comme les autres applications du serveur) |
| Nginx | site `bijoux-de-bois.com` + `www.bijoux-de-bois.com`, HTTPS actif (Let's Encrypt, renouvellement automatique) |
| Adresse | <https://bijoux-de-bois.com> (DNS basculé le 11 octobre 2026) |
| Code source | <https://github.com/cagira-coder/bijoux-de-bois>, déploiement automatique à chaque envoi |
| Paiement | mode démonstration tant que la clé Stripe n'est pas renseignée |

## Comment ça s'articule

- **GitHub** conserve le code et son historique.
- **Le VPS** fait tourner le site 24 h/24 avec pm2, qui le relance seul en cas de plantage ou de redémarrage du serveur.
- **Nginx** reçoit les visiteurs, gère le HTTPS et transmet à l'application sur le port 3020.
- **Stripe** encaisse les paiements et renvoie le client sur le site.

## Ce qu'il reste à faire

### 1. Basculer le domaine vers le VPS (espace client OVH)

Aujourd'hui, `bijoux-de-bois.com` pointe vers un **hébergement web mutualisé OVH** (adresse 213.186.33.19) qui fait tourner un ancien site WordPress, actuellement en erreur de base de données. Pointer le domaine vers le VPS remplacera ce site.

Si vous voulez récupérer des photos ou des textes de l'ancien site, faites-le avant : espace client OVH → **Hébergements** → votre hébergement → onglet **FTP-SSH**. Les photos WordPress sont dans `wp-content/uploads`.

Puis : **Noms de domaine → bijoux-de-bois.com → Zone DNS**.

1. **Modifiez** l'enregistrement `A` dont le sous-domaine est vide : remplacez `213.186.33.19` par `152.228.131.140`.
2. **Modifiez** de la même façon l'enregistrement `A` du sous-domaine `www`.
3. **Supprimez** les deux enregistrements `AAAA` (adresse IPv6 de l'ancien hébergement), sinon une partie des visiteurs continuerait d'arriver sur l'ancien site.

La propagation prend de quelques minutes à quelques heures. Vérifiez depuis votre PC que la réponse affiche `152.228.131.140` :

```bash
nslookup bijoux-de-bois.com
```

### 2. Activer le HTTPS

Une fois le DNS propagé, sur le VPS :

```bash
sudo certbot --nginx -d bijoux-de-bois.com -d www.bijoux-de-bois.com --redirect
```

Le certificat se renouvelle ensuite tout seul, comme pour les autres sites du serveur.

### 3. Choisir le mot de passe de l'administration

L'espace d'administration est à l'adresse `/admin` (provisoirement <http://152.228.131.140/admin>, puis <https://bijoux-de-bois.com/admin>). À la première visite, vous choisissez votre mot de passe. Il est conseillé d'attendre que le HTTPS soit actif (étape 2) pour le faire, afin que le mot de passe ne circule pas en clair.

Depuis cet espace, vous gérez les produits, les photos, le stock et consultez les commandes, sans toucher aux fichiers. Les données saisies restent sur le VPS : les mises à jour du site (`deploy/envoyer.sh` ou GitHub) ne les écrasent pas.

Mot de passe oublié ? Sur le VPS : `rm /var/www/boutique/data/admin.json`, puis retournez sur `/admin`.

### 4. Activer le paiement

Sur le VPS, collez votre clé Stripe après `STRIPE_SECRET_KEY=` :

```bash
nano /var/www/boutique/.env
```

Enregistrez avec `Ctrl+O` puis `Entrée`, quittez avec `Ctrl+X`, puis :

```bash
pm2 restart boutique
```

Dans le Dashboard Stripe, l'URL du webhook à déclarer est `https://bijoux-de-bois.com/api/webhook` (voir le README).

### 5. Déploiement automatique depuis GitHub

C'est en place depuis le 11 octobre 2026 : à chaque envoi sur la branche `main` du dépôt, GitHub se connecte au VPS avec une clé SSH dédiée et lance `deploy/deploy.sh`. L'onglet **Actions** du dépôt montre chaque déploiement et son résultat. Les trois secrets nécessaires (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`) sont enregistrés dans le dépôt, et le dossier `/var/www/boutique` du VPS est relié au dépôt.

## Mettre à jour le site

### Depuis votre PC, sans passer par GitHub

Dans Git Bash, à la racine du projet :

```bash
bash deploy/envoyer.sh
```

Le script envoie les fichiers sur le VPS (sauf `.env` et les commandes enregistrées), installe les dépendances et relance la boutique.

### Avec GitHub

Envoyez vos modifications (`git push`). Si le déploiement automatique est configuré, c'est terminé. Sinon, sur le VPS :

```bash
bash /var/www/boutique/deploy/deploy.sh
```

## Commandes utiles sur le VPS

```bash
pm2 list
```

```bash
pm2 logs boutique
```

```bash
pm2 restart boutique
```

## Fichiers concernés

| Fichier | Rôle |
|---|---|
| `deploy/envoyer.sh` | Depuis le PC : envoie le site sur le VPS et le relance |
| `deploy/vps-install.sh` | Sur le VPS : installe les dépendances, crée `.env`, démarre pm2, configure Nginx. Relançable sans risque |
| `deploy/deploy.sh` | Sur le VPS : récupère la dernière version depuis GitHub puis relance l'installation |
| `deploy/ecosystem.config.js` | Configuration pm2 (nom, port 3020) |
| `deploy/nginx.conf` | Site Nginx (HTTP vers le port 3020 ; HTTPS ajouté par Certbot) |
| `.github/workflows/deploy.yml` | Déploiement automatique depuis GitHub |

## En cas de problème

| Symptôme | Piste |
|---|---|
| L'ancien site WordPress s'affiche encore | Propagation DNS en cours, ou enregistrements `AAAA` non supprimés |
| « Certificat invalide » ou certbot échoue | Le DNS ne pointe pas encore vers le VPS, vérifiez avec `nslookup` |
| Page d'erreur 502 | L'application est arrêtée : `pm2 restart boutique` puis `pm2 logs boutique` |
| Le paiement reste en mode démonstration | La clé Stripe manque dans `/var/www/boutique/.env`, ou `pm2 restart boutique` n'a pas été fait |
| Les images ne s'affichent pas sur la page Stripe | Normal avec les images SVG de démonstration ; utilisez des JPG ou PNG |
