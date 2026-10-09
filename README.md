# Bijoux de Bois — site de vente en ligne

Un site de vente complet et léger : catalogue avec plusieurs photos par produit, fiche produit avec galerie, panier, et paiement par carte bancaire via **Stripe Checkout**.

## Fonctionnalités

- Page d'accueil avec grille de produits et filtres par catégorie
- Fiche produit avec galerie photo (image principale + miniatures), quantité et ajout au panier
- Panier persistant (conservé dans le navigateur), modification des quantités
- Paiement sécurisé par carte avec Stripe (Apple Pay / Google Pay inclus automatiquement)
- Collecte de l'adresse de livraison pendant le paiement
- Pages de confirmation et d'annulation
- Enregistrement des commandes dans `data/orders.json` (via webhook Stripe, facultatif)
- Mode démonstration sans clé Stripe : le paiement est simulé pour tester le parcours complet
- Design responsive (mobile, tablette, ordinateur)

## Démarrage rapide

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus.

```bash
npm install
npm start
```

Ouvrez ensuite <http://localhost:3000>. Sans clé Stripe, le site tourne en **mode démonstration** : le bouton « Payer » mène directement à la page de confirmation, sans paiement réel.

## Espace d'administration

Rendez-vous sur `/admin` (par exemple <http://localhost:3000/admin> en local). À la première visite, vous choisissez le mot de passe qui protège l'administration ; il est stocké haché dans `data/admin.json`. Vous pouvez ensuite :

- ajouter, modifier, réordonner ou supprimer des produits ;
- envoyer des photos depuis votre ordinateur ou votre téléphone (elles sont redimensionnées automatiquement en 1200 px et converties en JPG) ;
- gérer le stock (0 affiche « Épuisé ») ;
- consulter les commandes (lues depuis Stripe une fois la clé renseignée) ;
- changer le mot de passe.

Mot de passe oublié ? Supprimez le fichier `data/admin.json` sur le serveur et retournez sur `/admin` pour en choisir un nouveau.

## Ajouter ou modifier des produits à la main

Le catalogue vivant est `data/products.json` (créé au premier démarrage à partir de `data/products.example.json`). L'administration le modifie pour vous, mais vous pouvez aussi l'éditer directement. Chaque produit ressemble à ceci :

```json
{
  "id": "bracelet-olivier",
  "name": "Bracelet en bois d'olivier",
  "category": "Bracelets",
  "price": 24,
  "shortDescription": "Olivier massif, fermoir aimanté",
  "description": "Texte complet affiché sur la fiche produit.",
  "images": [
    "/images/products/bracelet-olivier-1.jpg",
    "/images/products/bracelet-olivier-2.jpg"
  ],
  "stock": 12
}
```

| Champ | Rôle |
|---|---|
| `id` | Identifiant unique, sans espaces ni accents (utilisé dans l'adresse de la page) |
| `name` | Nom affiché |
| `category` | Sert aux filtres de la page d'accueil (créez autant de catégories que vous voulez) |
| `price` | Prix TTC, avec un point comme séparateur décimal |
| `shortDescription` | Une ligne affichée sous le nom dans la grille |
| `description` | Texte complet de la fiche produit |
| `images` | Liste des photos : la première sert de vignette, toutes apparaissent dans la galerie |
| `stock` | Mettez `0` pour afficher « Épuisé » et bloquer l'achat |

Le serveur recharge le catalogue automatiquement quand vous enregistrez le fichier.

### Vos photos

1. Déposez vos photos dans `public/images/products/` (JPG ou PNG, idéalement carrées, 1000 × 1000 px environ).
2. Indiquez leurs chemins dans le champ `images` du produit, en commençant par `/images/products/`.

Les images `.svg` actuelles sont des exemples générés par `npm run images`. Vous pouvez les supprimer dès que vous avez vos vraies photos.

## Activer le paiement Stripe

1. Créez un compte sur <https://stripe.com> (gratuit, sans abonnement : Stripe prend une commission par transaction).
2. Dans le Dashboard Stripe, ouvrez **Développeurs → Clés API** et copiez la **clé secrète de test** (elle commence par `sk_test_`).
3. Copiez le fichier `.env.example` en `.env` et collez la clé :

   ```
   STRIPE_SECRET_KEY=sk_test_votre_cle
   BASE_URL=http://localhost:3000
   ```

4. Relancez `npm start`. Le bouton « Payer » redirige maintenant vers la page de paiement Stripe.

### Tester un paiement

En mode test, utilisez la carte `4242 4242 4242 4242`, n'importe quelle date d'expiration future, n'importe quel code CVC et n'importe quel code postal. Aucun argent n'est débité.

### Passer en réel

1. Activez votre compte Stripe (informations légales et bancaires demandées par Stripe).
2. Remplacez la clé de test par la **clé secrète live** (`sk_live_...`) dans `.env`.
3. Mettez `BASE_URL` à l'adresse publique de votre site (en `https://`).

## Enregistrer les commandes (webhook, facultatif)

Les commandes sont toujours visibles dans le Dashboard Stripe. Pour qu'elles soient aussi écrites dans `data/orders.json` :

1. Dans Stripe, **Développeurs → Webhooks → Ajouter un endpoint** avec l'URL `https://votre-site.fr/api/webhook` et l'événement `checkout.session.completed`.
2. Copiez le **secret de signature** (`whsec_...`) dans `.env` :

   ```
   STRIPE_WEBHOOK_SECRET=whsec_votre_secret
   ```

En local, vous pouvez tester avec la [CLI Stripe](https://stripe.com/docs/stripe-cli) :

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

## Mettre le site en ligne

### Sur votre VPS (OVH ou autre)

Suivez le guide pas à pas [DEPLOIEMENT-VPS.md](DEPLOIEMENT-VPS.md). Il installe tout en une commande (Node.js, Nginx, HTTPS, démarrage automatique) et permet la mise à jour automatique à chaque envoi sur GitHub.

### Sur un hébergeur clé en main

Le site est une application Node.js classique. Sur [Render](https://render.com), [Railway](https://railway.app) ou tout hébergeur Node :

- Commande d'installation : `npm install`
- Commande de démarrage : `npm start`
- Variables d'environnement : `STRIPE_SECRET_KEY`, `BASE_URL` (l'adresse publique en `https://`), et éventuellement `STRIPE_WEBHOOK_SECRET` et `CURRENCY`.

## Personnaliser l'apparence

- **Nom de la boutique et textes** : dans les fichiers `public/*.html` (en-tête, pied de page, texte d'accueil).
- **Couleurs et police** : tout en haut de `public/css/style.css`, dans le bloc `:root`.
- **Devise** : variable `CURRENCY` dans `.env` (`eur` par défaut).
- **Pays de livraison acceptés** : liste `allowed_countries` dans `server.js`.

## Structure du projet

```
├── server.js                  Serveur Express : pages, API catalogue, paiement Stripe, webhook
├── data/
│   ├── products.json          Catalogue (à modifier)
│   └── orders.json            Commandes enregistrées par le webhook (créé automatiquement)
├── public/
│   ├── index.html             Accueil / catalogue
│   ├── product.html           Fiche produit avec galerie
│   ├── cart.html              Panier et bouton de paiement
│   ├── success.html           Confirmation de commande
│   ├── cancel.html            Paiement annulé
│   ├── css/style.css          Styles
│   ├── js/app.js              Logique front (catalogue, panier, paiement)
│   └── images/products/       Photos des produits
├── scripts/generate-placeholders.js   Génère les images de démonstration
├── .env.example               Modèle de configuration
└── package.json
```
