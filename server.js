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
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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

  // Une commande est confirmée à « completed » pour la carte, ou plus tard à
  // « async_payment_succeeded » pour les paiements différés (prélèvement SEPA, virement…).
  // Stripe peut renvoyer un même événement plusieurs fois : la commande n'est enregistrée
  // qu'une fois et le stock n'est retiré qu'une fois. On ne répond 200 qu'après traitement,
  // pour que Stripe rejoue l'événement en cas d'erreur.
  const handled = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
  if (!handled.includes(event.type)) return res.json({ received: true });

  const session = event.data.object;
  try {
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    const status = event.type === 'checkout.session.async_payment_failed' ? 'failed' : session.payment_status;
    const order = upsertOrder({
      id: session.id,
      date: new Date().toISOString(),
      email: session.customer_details?.email || null,
      name: session.customer_details?.name || null,
      total: session.amount_total / 100,
      currency: session.currency,
      status,
      shipping: session.shipping_details || session.collected_information?.shipping_details || null,
    });
    if (paid && !order.stockUpdated) {
      const alert = await decrementStock(session.id);
      upsertOrder({ id: session.id, stockUpdated: true, ...(alert ? { alert } : {}) });
    }
    console.log(`Commande ${session.id} : ${status}`);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook Stripe :', err.message);
    res.status(500).send('Erreur de traitement, Stripe réessaiera.');
  }
});

// Retire du stock les articles d'une commande payée. Chaque article Stripe porte l'identifiant
// du produit dans ses métadonnées (voir /api/checkout). Renvoie un message d'alerte si un
// article a été vendu au-delà du stock (deux clients ayant payé le dernier exemplaire).
async function decrementStock(sessionId) {
  const lines = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ['data.price.product'] });
  const sold = new Map();
  for (const line of lines.data) {
    const id = line.price?.product?.metadata?.product_id;
    if (id) sold.set(id, (sold.get(id) || 0) + line.quantity);
  }
  if (sold.size === 0) return null;
  const oversold = [];
  catalog.save(products.map((p) => {
    if (!sold.has(p.id) || !Number.isInteger(p.stock)) return p; // stock absent = non suivi
    const remaining = p.stock - sold.get(p.id);
    if (remaining < 0) oversold.push(`${p.name} (${-remaining} de trop)`);
    return { ...p, stock: Math.max(0, remaining) };
  }));
  console.log('Stock mis à jour :', [...sold].map(([id, q]) => `${id} −${q}`).join(', '));
  if (oversold.length === 0) return null;
  const alert = `Vendu au-delà du stock : ${oversold.join(', ')}. Vérifiez la commande.`;
  console.warn(`Commande ${sessionId} : ${alert}`);
  return alert;
}

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

  // Les quantités sont cumulées par produit : deux lignes pour le même article comptent ensemble.
  const wanted = new Map();
  for (const item of items) {
    const id = String(item?.id);
    const quantity = Number.parseInt(item?.quantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: 'Panier invalide.' });
    wanted.set(id, (wanted.get(id) || 0) + quantity);
  }

  for (const [id, quantity] of wanted) {
    const product = productById.get(id);
    if (!product || quantity > 99) {
      return res.status(400).json({ error: 'Panier invalide.' });
    }
    if (product.stock === 0) {
      return res.status(400).json({ error: `« ${product.name} » est épuisé.` });
    }
    if (quantity > product.stock) {
      return res.status(400).json({
        error: `« ${product.name} » : il ne reste que ${product.stock} exemplaire${product.stock > 1 ? 's' : ''} en stock.`,
      });
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
          metadata: { product_id: product.id },
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

// Enregistre ou met à jour une commande (identifiée par sa session Stripe) et renvoie la
// commande enregistrée. Un événement rejoué ne crée donc jamais de doublon.
function upsertOrder(order) {
  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch {
    // Pas encore de fichier de commandes.
  }
  const index = orders.findIndex((o) => o.id === order.id);
  const previous = orders[index];
  const merged = index === -1 ? order : { ...previous, ...order, date: previous.date };
  // Les événements Stripe peuvent arriver dans le désordre : un statut final (payé, refusé) n'est jamais
  // remplacé par « en attente ».
  if (previous && order.status === 'unpaid' && ['paid', 'no_payment_required', 'failed'].includes(previous.status)) {
    merged.status = previous.status;
  }
  if (index === -1) orders.push(merged);
  else orders[index] = merged;
  const tmp = `${ORDERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
  return merged;
}

app.listen(PORT, () => {
  console.log(`Boutique en ligne : ${BASE_URL || `http://localhost:${PORT}`}`);
});
