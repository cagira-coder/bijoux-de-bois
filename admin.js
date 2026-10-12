'use strict';

// Espace d'administration : connexion par mot de passe, gestion des produits,
// envoi de photos (redimensionnées automatiquement) et liste des commandes.
//
// Le mot de passe est choisi lors de la première visite de /admin et stocké,
// haché, dans data/admin.json. Aucun mot de passe ne transite par le code.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const SESSION_DAYS = 7;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const COOKIE = 'admin_session';

module.exports = function createAdminRouter({ catalog, categoryStore, stripe, dataDir, imagesDir }) {
  const router = express.Router();
  const adminFile = path.join(dataDir, 'admin.json');
  const ordersFile = path.join(dataDir, 'orders.json');

  // --- Compte administrateur ----------------------------------------------

  function readAdmin() {
    try {
      return JSON.parse(fs.readFileSync(adminFile, 'utf8'));
    } catch {
      return null;
    }
  }

  function writeAdmin(admin) {
    fs.writeFileSync(adminFile, JSON.stringify(admin, null, 2), { mode: 0o600 });
  }

  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
  }

  function verifyPassword(password, admin) {
    const { hash } = hashPassword(password, admin.salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(admin.hash, 'hex'));
  }

  function validPassword(password) {
    return typeof password === 'string' && password.length >= 8 && password.length <= 200;
  }

  // --- Sessions (cookie signé) --------------------------------------------

  const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

  function makeToken(admin) {
    const payload = `${Date.now() + SESSION_DAYS * 86400000}.${admin.version}`;
    return `${payload}.${sign(payload, admin.secret)}`;
  }

  function readCookie(req, name) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  function isAuthenticated(req) {
    const admin = readAdmin();
    const token = readCookie(req, COOKIE);
    if (!admin || !token) return false;
    const [expires, version, signature] = token.split('.');
    if (!expires || !version || !signature) return false;
    const expected = sign(`${expires}.${version}`, admin.secret);
    if (signature.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    return Number(expires) > Date.now() && Number(version) === admin.version;
  }

  function setSession(req, res, admin) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(admin)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  function requireAuth(req, res, next) {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Connexion requise.' });
    next();
  }

  // --- Protection contre les essais répétés --------------------------------

  const attempts = new Map();

  function lockedMinutes(ip) {
    const entry = attempts.get(ip);
    if (entry && entry.until > Date.now()) return Math.ceil((entry.until - Date.now()) / 60000);
    return 0;
  }

  function recordFailure(ip) {
    const entry = attempts.get(ip) || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_ATTEMPTS) {
      entry.until = Date.now() + LOCK_MINUTES * 60000;
      entry.count = 0;
    }
    attempts.set(ip, entry);
  }

  // --- Connexion -----------------------------------------------------------

  router.get('/status', (req, res) => {
    res.json({ configured: Boolean(readAdmin()), authenticated: isAuthenticated(req), paymentsEnabled: Boolean(stripe) });
  });

  router.post('/setup', (req, res) => {
    if (readAdmin()) return res.status(400).json({ error: 'Un mot de passe existe déjà.' });
    const { password } = req.body || {};
    if (!validPassword(password)) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
    const admin = {
      ...hashPassword(password),
      secret: crypto.randomBytes(32).toString('hex'),
      version: 1,
      createdAt: new Date().toISOString(),
    };
    writeAdmin(admin);
    setSession(req, res, admin);
    res.json({ ok: true });
  });

  router.post('/login', (req, res) => {
    const admin = readAdmin();
    if (!admin) return res.status(400).json({ error: 'Aucun mot de passe défini.' });
    const minutes = lockedMinutes(req.ip);
    if (minutes) return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${minutes} min.` });
    const { password } = req.body || {};
    if (typeof password !== 'string' || !verifyPassword(password, admin)) {
      recordFailure(req.ip);
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }
    attempts.delete(req.ip);
    setSession(req, res, admin);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  router.post('/password', requireAuth, (req, res) => {
    const admin = readAdmin();
    const { current, next } = req.body || {};
    if (typeof current !== 'string' || !verifyPassword(current, admin)) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }
    if (!validPassword(next)) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
    const updated = { ...admin, ...hashPassword(next), version: admin.version + 1 };
    writeAdmin(updated);
    setSession(req, res, updated);
    res.json({ ok: true });
  });

  // --- Produits ------------------------------------------------------------

  function slugify(value) {
    const slug = String(value)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return slug || 'produit';
  }

  function uniqueId(base, existing) {
    let id = base;
    let n = 2;
    while (existing.has(id)) id = `${base}-${n++}`;
    return id;
  }

  function cleanProduct(body, existing) {
    const name = String(body.name || '').trim();
    const price = Number(String(body.price ?? '').replace(',', '.'));
    const stock = Number.parseInt(body.stock, 10);
    const images = Array.isArray(body.images)
      ? body.images.filter((s) => typeof s === 'string' && /^\/images\/products\/[\w.-]+$/.test(s))
      : [];

    if (!name) return { error: 'Le nom est obligatoire.' };
    if (!Number.isFinite(price) || price < 0) return { error: 'Le prix est invalide.' };
    if (!Number.isInteger(stock) || stock < 0) return { error: 'Le stock est invalide.' };
    if (images.length === 0) return { error: 'Ajoutez au moins une photo.' };

    return {
      product: {
        ...existing,
        name,
        category: String(body.category || '').trim() || 'Divers',
        price: Math.round(price * 100) / 100,
        shortDescription: String(body.shortDescription || '').trim(),
        description: String(body.description || '').trim(),
        images,
        stock,
      },
    };
  }

  function removeOrphanImages(oldImages, products) {
    const used = new Set(products.flatMap((p) => p.images));
    for (const image of oldImages || []) {
      if (used.has(image) || !image.startsWith('/images/products/')) continue;
      fs.promises.unlink(path.join(imagesDir, path.basename(image))).catch(() => {});
    }
  }

  router.get('/products', requireAuth, (req, res) => {
    res.json(catalog.all());
  });

  router.post('/products', requireAuth, (req, res) => {
    const list = catalog.all();
    const result = cleanProduct(req.body || {}, {});
    if (result.error) return res.status(400).json({ error: result.error });
    const product = { id: uniqueId(slugify(result.product.name), new Set(list.map((p) => p.id))), ...result.product };
    catalog.save([...list, product]);
    res.status(201).json(product);
  });

  router.put('/products/:id', requireAuth, (req, res) => {
    const list = catalog.all();
    const index = list.findIndex((p) => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Produit introuvable.' });
    const result = cleanProduct(req.body || {}, list[index]);
    if (result.error) return res.status(400).json({ error: result.error });
    const next = [...list];
    next[index] = { ...result.product, id: list[index].id };
    removeOrphanImages(list[index].images, next);
    catalog.save(next);
    res.json(next[index]);
  });

  router.delete('/products/:id', requireAuth, (req, res) => {
    const list = catalog.all();
    const product = list.find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
    const next = list.filter((p) => p !== product);
    removeOrphanImages(product.images, next);
    catalog.save(next);
    res.json({ ok: true });
  });

  // Ordre d'affichage dans la boutique.
  router.put('/order', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const list = catalog.all();
    const byId = new Map(list.map((p) => [p.id, p]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length !== list.length) return res.status(400).json({ error: 'Liste incomplète.' });
    catalog.save(ordered);
    res.json({ ok: true });
  });

  // --- Catégories ----------------------------------------------------------

  function cleanCategoryName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) return { error: 'Le nom de la catégorie est obligatoire.' };
    if (name.length > 40) return { error: 'Nom trop long (40 caractères maximum).' };
    return { name };
  }

  router.get('/categories', requireAuth, (req, res) => {
    const counts = new Map();
    for (const p of catalog.all()) counts.set(p.category, (counts.get(p.category) || 0) + 1);
    res.json(categoryStore.all().map((name) => ({ name, count: counts.get(name) || 0 })));
  });

  router.post('/categories', requireAuth, (req, res) => {
    const { name, error } = cleanCategoryName(req.body?.name);
    if (error) return res.status(400).json({ error });
    const list = categoryStore.all();
    if (list.some((c) => c.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'Cette catégorie existe déjà.' });
    }
    categoryStore.save([...list, name]);
    res.status(201).json({ ok: true, name });
  });

  // Renomme une catégorie pour tous ses produits (vers un nom existant = fusion).
  router.put('/categories', requireAuth, (req, res) => {
    const from = String(req.body?.from || '').trim();
    const { name: to, error } = cleanCategoryName(req.body?.to);
    if (error) return res.status(400).json({ error });
    const list = categoryStore.all();
    if (!list.includes(from)) return res.status(404).json({ error: 'Catégorie introuvable.' });
    if (from === to) return res.json({ ok: true, updated: 0 });
    const existing = list.find((c) => c !== from && c.toLowerCase() === to.toLowerCase());
    const target = existing || to;
    let updated = 0;
    const products = catalog.all().map((p) => (p.category === from ? (updated += 1, { ...p, category: target }) : p));
    const next = existing ? list.filter((c) => c !== from) : list.map((c) => (c === from ? target : c));
    categoryStore.save(next);
    catalog.save(products);
    res.json({ ok: true, updated, merged: Boolean(existing) });
  });

  // Ordre d'affichage des catégories (filtres de la boutique).
  router.put('/categories/order', requireAuth, (req, res) => {
    const names = Array.isArray(req.body?.names) ? req.body.names : [];
    const list = categoryStore.all();
    if (names.length !== list.length || !names.every((n) => list.includes(n))) {
      return res.status(400).json({ error: 'Liste incomplète.' });
    }
    categoryStore.save(names);
    res.json({ ok: true });
  });

  // Suppression d'une catégorie vide uniquement.
  router.delete('/categories/:name', requireAuth, (req, res) => {
    const name = req.params.name;
    const list = categoryStore.all();
    if (!list.includes(name)) return res.status(404).json({ error: 'Catégorie introuvable.' });
    if (catalog.all().some((p) => p.category === name)) {
      return res.status(400).json({ error: 'Cette catégorie contient encore des produits : déplacez-les ou renommez-la.' });
    }
    categoryStore.save(list.filter((c) => c !== name));
    res.json({ ok: true });
  });

  // --- Photos --------------------------------------------------------------

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 10, fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif|tiff)$/.test(file.mimetype)),
  });

  router.post('/upload', requireAuth, upload.array('photos', 10), async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Aucune image reçue (formats acceptés : JPG, PNG, WebP).' });
    }
    const images = [];
    try {
      for (const file of files) {
        const base = slugify(path.parse(file.originalname).name).slice(0, 40) || 'photo';
        const name = `${base}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.jpg`;
        await sharp(file.buffer)
          .rotate()
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(path.join(imagesDir, name));
        images.push(`/images/products/${name}`);
      }
      res.json({ images });
    } catch (err) {
      console.error('Envoi de photo :', err.message);
      res.status(400).json({ error: 'Image illisible ou format non pris en charge.', images });
    }
  });

  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (20 Mo maximum).' : 'Envoi refusé.';
      return res.status(400).json({ error: message });
    }
    next(err);
  });

  // --- Commandes -----------------------------------------------------------

  router.get('/orders', requireAuth, async (req, res) => {
    if (stripe) {
      try {
        const sessions = await stripe.checkout.sessions.list({ limit: 50, status: 'complete', expand: ['data.line_items'] });
        return res.json({
          source: 'stripe',
          orders: sessions.data.map((s) => ({
            id: s.id,
            date: new Date(s.created * 1000).toISOString(),
            email: s.customer_details?.email || null,
            name: s.customer_details?.name || null,
            total: s.amount_total / 100,
            currency: s.currency,
            status: s.payment_status,
            shipping: s.shipping_details || s.collected_information?.shipping_details || null,
            items: (s.line_items?.data || []).map((line) => ({
              name: line.description,
              quantity: line.quantity,
              amount: line.amount_total / 100,
            })),
          })),
        });
      } catch (err) {
        console.error('Stripe (commandes) :', err.message);
      }
    }
    let orders = [];
    try {
      orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    } catch {
      // Pas encore de commandes.
    }
    res.json({ source: 'local', orders: orders.slice().reverse() });
  });

  return router;
};
