'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
// Adresse publique du site. Si BASE_URL est vide, elle est déduite de l'adresse visitée par le
// client (pratique tant que le nom de domaine n'est pas en place).
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

function baseUrl(req) {
  return BASE_URL || `${req.protocol}://${req.get('host')}`;
}
const CURRENCY = (process.env.CURRENCY || 'eur').toLowerCase();
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const IMAGES_DIR = path.join(__dirname, 'public', 'images', 'products');

// --- Catalogue -------------------------------------------------------------

// Au premier démarrage, le catalogue est créé à partir de l'exemple fourni.
if (!fs.existsSync(PRODUCTS_FILE)) {
  fs.copyFileSync(path.join(DATA_DIR, 'products.example.json'), PRODUCTS_FILE);
  console.log('Catalogue initial créé : data/products.json');
}

function loadProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
}

let products = loadProducts();
let productById = new Map(products.map((p) => [p.id, p]));

const catalog = {
  all: () => products,
  // Enregistre le catalogue (écriture atomique) et met à jour la version en mémoire.
  save(list) {
    const tmp = `${PRODUCTS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, PRODUCTS_FILE);
    products = list;
    productById = new Map(list.map((p) => [p.id, p]));
    // Toute catégorie utilisée par un produit figure dans la liste.
    const missing = list.map((p) => p.category).filter((c) => !categories.includes(c));
    if (missing.length) categoryStore.save([...categories, ...new Set(missing)]);
  },
};

// --- Catégories (ordre d'affichage, catégories vides autorisées) ----------

function loadCategories() {
  let stored = [];
  try {
    stored = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'));
  } catch {
    // Pas encore de fichier : la liste est déduite des produits.
  }
  const names = Array.isArray(stored) ? stored.filter((n) => typeof n === 'string') : [];
  for (const p of products) if (!names.includes(p.category)) names.push(p.category);
  return names;
}

let categories = loadCategories();

const categoryStore = {
  all: () => categories,
  save(list) {
    const tmp = `${CATEGORIES_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, CATEGORIES_FILE);
    categories = list;
  },
};

// Recharge le catalogue si data/products.json est modifié à la main.
fs.watchFile(PRODUCTS_FILE, { interval: 2000 }, () => {
  try {
    products = loadProducts();
    productById = new Map(products.map((p) => [p.id, p]));
    categories = loadCategories();
    console.log(`Catalogue rechargé (${products.length} produits)`);
  } catch (err) {
    console.error('products.json invalide :', err.message);
  }
});

// --- Stripe ----------------------------------------------------------------

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;

if (!stripe) {
  console.warn('STRIPE_SECRET_KEY absente : le paiement tourne en mode démonstration (aucun paiement réel).');
}

// --- Application -----------------------------------------------------------

const app = express();
app.disable('x-powered-by');
// Derrière Nginx : permet de connaître le vrai protocole (https) et l'adresse du visiteur.
app.set('trust proxy', 'loopback');

// Le webhook Stripe a besoin du corps brut de la requête : il est déclaré avant express.json().
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return res.status(503).send('Webhook non configuré (STRIPE_WEBHOOK_SECRET manquant).');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    return res.status(400).send(`Signature invalide : ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    saveOrder({
      id: session.id,
      date: new Date().toISOString(),
      email: session.customer_details?.email || null,
      name: session.customer_details?.name || null,
      total: session.amount_total / 100,
      currency: session.currency,
      status: session.payment_status,
      shipping: session.shipping_details || session.collected_information?.shipping_details || null,
    });
    console.log('Commande enregistrée :', session.id);
  }

  res.json({ received: true });
});

// En-têtes de sécurité : pas d'inclusion dans un autre site, pas de scripts externes,
// HTTPS forcé par le navigateur pendant un an une fois le site visité en https.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
    + "form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  );
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Espace d'administration : /admin (interface) et /api/admin/* (données).
app.use('/api/admin', require('./admin')({ catalog, categoryStore, stripe, dataDir: DATA_DIR, imagesDir: IMAGES_DIR }));

// --- API -------------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({ currency: CURRENCY, paymentsEnabled: Boolean(stripe) });
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

// Catégories dans l'ordre choisi dans l'administration (seules celles qui ont des produits).
app.get('/api/categories', (req, res) => {
  const used = new Set(products.map((p) => p.category));
  res.json(categories.filter((c) => used.has(c)));
});

app.get('/api/products/:id', (req, res) => {
  const product = productById.get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json(product);
});

// Crée une session Stripe Checkout à partir du panier.
// Les prix sont toujours relus depuis le catalogue côté serveur : le client ne peut pas les modifier.
app.post('/api/checkout', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const lineItems = [];

  for (const item of items) {
    const product = productById.get(String(item.id));
    const quantity = Number.parseInt(item.quantity, 10);

    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return res.status(400).json({ error: 'Panier invalide.' });
    }
    if (product.stock === 0) {
      return res.status(400).json({ error: `« ${product.name} » est épuisé.` });
    }

    const image = publicImageUrl(product, baseUrl(req));
    lineItems.push({
      quantity,
      price_data: {
        currency: CURRENCY,
        unit_amount: Math.round(product.price * 100),
        product_data: {
          name: product.name,
          description: product.shortDescription,
          ...(image ? { images: [image] } : {}),
        },
      },
    });
  }

  if (lineItems.length === 0) {
    return res.status(400).json({ error: 'Votre panier est vide.' });
  }

  if (!stripe) {
    // Mode démonstration : on simule un paiement réussi.
    return res.json({ demo: true, url: `${baseUrl(req)}/success.html?demo=1` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ['FR', 'BE', 'CH', 'LU', 'DE', 'ES', 'IT', 'NL', 'MC'],
      },
      success_url: `${baseUrl(req)}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl(req)}/cancel.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur Stripe :', err.message);
    res.status(500).json({ error: 'Impossible de créer la session de paiement. Réessayez dans un instant.' });
  }
});

// Récapitulatif d'une commande pour la page de confirmation.
app.get('/api/order/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!stripe) return res.status(503).json({ error: 'Stripe non configuré.' });
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Identifiant invalide.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
    res.json({
      status: session.payment_status,
      email: session.customer_details?.email || null,
      total: session.amount_total / 100,
      currency: session.currency,
      items: (session.line_items?.data || []).map((line) => ({
        name: line.description,
        quantity: line.quantity,
        amount: line.amount_total / 100,
      })),
    });
  } catch {
    res.status(404).json({ error: 'Commande introuvable.' });
  }
});

// --- Utilitaires -----------------------------------------------------------

// Stripe n'affiche que des images accessibles publiquement en https, au format JPG ou PNG.
function publicImageUrl(product, base) {
  const first = product.images?.[0];
  if (!first || first.endsWith('.svg')) return null;
  if (first.startsWith('https://')) return first;
  if (!base.startsWith('https://')) return null;
  return `${base}${first}`;
}

function saveOrder(order) {
  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch {
    // Pas encore de fichier de commandes.
  }
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

app.listen(PORT, () => {
  console.log(`Boutique en ligne : ${BASE_URL || `http://localhost:${PORT}`}`);
});
