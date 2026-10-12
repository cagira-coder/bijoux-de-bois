/* Boutique : catalogue, panier (localStorage) et paiement. */
(() => {
  'use strict';

  const CART_KEY = 'boutique-cart';
  const LAST_ORDER_KEY = 'boutique-last-order';

  let config = { currency: 'eur', paymentsEnabled: false };
  let formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  let productsPromise = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // ---------- Utilitaires ----------

  const formatPrice = (amount) => formatter.format(amount);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  let toastTimer;
  function toast(message, link) {
    const el = $('#toast');
    if (!el) return;
    el.innerHTML = escapeHtml(message) + (link ? ` <a href="${link.href}">${escapeHtml(link.label)}</a>` : '');
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3000);
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      config = await res.json();
      formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: config.currency.toUpperCase() });
    } catch {
      // Valeurs par défaut conservées.
    }
  }

  function loadProducts() {
    if (!productsPromise) {
      productsPromise = fetch('/api/products').then((res) => {
        if (!res.ok) throw new Error('Impossible de charger le catalogue.');
        return res.json();
      });
    }
    return productsPromise;
  }

  // ---------- Panier ----------

  function getCart() {
    try {
      const cart = JSON.parse(localStorage.getItem(CART_KEY));
      return Array.isArray(cart) ? cart : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }

  function addToCart(id, quantity = 1) {
    const cart = getCart();
    const line = cart.find((l) => l.id === id);
    if (line) line.quantity = clamp(line.quantity + quantity, 1, 99);
    else cart.push({ id, quantity: clamp(quantity, 1, 99) });
    saveCart(cart);
  }

  function setQuantity(id, quantity) {
    saveCart(getCart().map((l) => (l.id === id ? { ...l, quantity: clamp(quantity, 1, 99) } : l)));
  }

  function removeFromCart(id) {
    saveCart(getCart().filter((l) => l.id !== id));
  }

  function clearCart() {
    saveCart([]);
  }

  function cartCount() {
    return getCart().reduce((n, l) => n + l.quantity, 0);
  }

  function updateCartBadge() {
    const n = cartCount();
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  // ---------- Rendu ----------

  const productUrl = (p) => `/product.html?id=${encodeURIComponent(p.id)}`;

  function productCard(p) {
    const soldOut = p.stock === 0;
    return `
      <article class="card">
        <a class="card__image" href="${productUrl(p)}">
          <img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" loading="lazy">
        </a>
        <div class="card__body">
          <span class="card__category">${escapeHtml(p.category)}</span>
          <h3 class="card__title"><a href="${productUrl(p)}">${escapeHtml(p.name)}</a></h3>
          <p class="card__desc">${escapeHtml(p.shortDescription)}</p>
          <div class="card__footer">
            <span class="price">${formatPrice(p.price)}</span>
            <button class="btn btn--primary" data-add="${escapeHtml(p.id)}" ${soldOut ? 'disabled' : ''}>
              ${soldOut ? 'Épuisé' : 'Ajouter'}
            </button>
          </div>
        </div>
      </article>`;
  }

  function orderLines(items, total) {
    return `
      <ul class="order-lines">
        ${items.map((l) => `<li><span>${escapeHtml(l.name)} × ${l.quantity}</span><span>${formatPrice(l.amount)}</span></li>`).join('')}
        <li class="total"><span>Total</span><span>${formatPrice(total)}</span></li>
      </ul>`;
  }

  // ---------- Page d'accueil ----------

  async function initHome() {
    const grid = $('#product-grid');
    const filters = $('#category-filters');

    let products;
    try {
      products = await loadProducts();
    } catch (err) {
      grid.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      return;
    }

    // Ordre des filtres défini dans l'administration (repli : ordre d'apparition des produits).
    let ordered = [];
    try {
      const res = await fetch('/api/categories');
      if (res.ok) ordered = await res.json();
    } catch {
      // Repli ci-dessous.
    }
    const fromProducts = [...new Set(products.map((p) => p.category))];
    const categories = ['Tous', ...ordered.filter((c) => fromProducts.includes(c)), ...fromProducts.filter((c) => !ordered.includes(c))];
    filters.innerHTML = categories
      .map((c, i) => `<button class="chip${i === 0 ? ' is-active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join('');

    const render = (category) => {
      const list = products.filter((p) => category === 'Tous' || p.category === category);
      grid.innerHTML = list.length ? list.map(productCard).join('') : '<p class="empty">Aucun produit dans cette catégorie.</p>';
    };
    render('Tous');

    filters.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-category]');
      if (!chip) return;
      $$('.chip', filters).forEach((c) => c.classList.toggle('is-active', c === chip));
      render(chip.dataset.category);
    });
  }

  // ---------- Fiche produit ----------

  async function initProduct() {
    const root = $('#product');
    const id = new URLSearchParams(location.search).get('id');

    let product;
    try {
      product = (await loadProducts()).find((p) => p.id === id);
    } catch {
      // Géré ci-dessous.
    }
    if (!product) {
      root.innerHTML = '<div class="empty"><p>Ce produit est introuvable.</p><a class="btn btn--primary" href="/">Retour à la boutique</a></div>';
      return;
    }

    document.title = `${product.name} · Bijoux de Bois`;
    const soldOut = product.stock === 0;
    const thumbs = product.images.length > 1
      ? `<div class="gallery__thumbs">${product.images.map((src, i) => `
          <button type="button" class="gallery__thumb${i === 0 ? ' is-active' : ''}" data-src="${escapeHtml(src)}" aria-label="Photo ${i + 1}">
            <img src="${escapeHtml(src)}" alt="" loading="lazy">
          </button>`).join('')}</div>`
      : '';

    root.innerHTML = `
      <div class="gallery">
        <div class="gallery__main"><img id="main-image" src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}"></div>
        ${thumbs}
      </div>
      <div class="product-info">
        <a class="back" href="/">← Retour à la boutique</a>
        <div><span class="card__category">${escapeHtml(product.category)}</span></div>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="price price--lg">${formatPrice(product.price)}</p>
        <p class="product-info__desc">${escapeHtml(product.description)}</p>
        <p class="stock ${soldOut ? 'out' : 'in'}">${soldOut ? 'Épuisé' : 'En stock'}</p>
        <div class="add-row">
          <div class="qty" aria-label="Quantité">
            <button type="button" data-qty="-1" aria-label="Diminuer">−</button>
            <input id="qty" type="number" min="1" max="99" value="1" inputmode="numeric">
            <button type="button" data-qty="1" aria-label="Augmenter">+</button>
          </div>
          <button class="btn btn--primary btn--lg" id="add-btn" ${soldOut ? 'disabled' : ''}>Ajouter au panier</button>
        </div>
      </div>`;

    const qtyInput = $('#qty', root);
    const readQty = () => clamp(parseInt(qtyInput.value, 10) || 1, 1, 99);

    root.addEventListener('click', (e) => {
      const step = e.target.closest('[data-qty]');
      if (step) {
        qtyInput.value = clamp(readQty() + Number(step.dataset.qty), 1, 99);
        return;
      }
      const thumb = e.target.closest('.gallery__thumb');
      if (thumb) {
        $('#main-image', root).src = thumb.dataset.src;
        $$('.gallery__thumb', root).forEach((t) => t.classList.toggle('is-active', t === thumb));
      }
    });
    qtyInput.addEventListener('change', () => { qtyInput.value = readQty(); });

    $('#add-btn', root).addEventListener('click', () => {
      addToCart(product.id, readQty());
      toast('Ajouté au panier', { href: '/cart.html', label: 'Voir le panier' });
    });
  }

  // ---------- Panier ----------

  async function initCart() {
    const root = $('#cart');

    let products;
    try {
      products = await loadProducts();
    } catch (err) {
      root.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      return;
    }
    const byId = new Map(products.map((p) => [p.id, p]));

    const render = () => {
      // Les produits retirés du catalogue sont retirés du panier.
      const stored = getCart();
      const lines = stored.map((l) => ({ ...l, product: byId.get(l.id) })).filter((l) => l.product);
      if (lines.length !== stored.length) saveCart(lines.map(({ id, quantity }) => ({ id, quantity })));

      if (lines.length === 0) {
        root.innerHTML = '<div class="empty"><p>Votre panier est vide.</p><a class="btn btn--primary" href="/">Découvrir la boutique</a></div>';
        return;
      }

      const total = lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
      const count = lines.reduce((n, l) => n + l.quantity, 0);
      const demoNotice = config.paymentsEnabled
        ? ''
        : '<div class="notice"><strong>Mode démonstration :</strong> Stripe n\'est pas encore configuré, le paiement sera simulé. Suivez le fichier README.md pour l\'activer.</div>';

      root.innerHTML = `
        ${demoNotice}
        <div class="cart-layout">
          <div class="cart-list">
            ${lines.map(({ product: p, quantity }) => `
              <div class="cart-item" data-id="${escapeHtml(p.id)}">
                <a class="cart-item__img" href="${productUrl(p)}"><img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}"></a>
                <div>
                  <h3 class="cart-item__name"><a href="${productUrl(p)}">${escapeHtml(p.name)}</a></h3>
                  <p class="cart-item__unit">${formatPrice(p.price)} l'unité</p>
                  <div class="qty" aria-label="Quantité">
                    <button type="button" data-qty="-1" aria-label="Diminuer">−</button>
                    <input type="number" min="1" max="99" value="${quantity}" data-qty-input inputmode="numeric">
                    <button type="button" data-qty="1" aria-label="Augmenter">+</button>
                  </div>
                </div>
                <div class="cart-item__right">
                  <span class="price">${formatPrice(p.price * quantity)}</span>
                  <button type="button" class="link-danger" data-remove>Retirer</button>
                </div>
              </div>`).join('')}
          </div>
          <aside class="summary">
            <h2>Récapitulatif</h2>
            <div class="summary__row"><span>Articles</span><span>${count}</span></div>
            <div class="summary__row"><span>Livraison</span><span>Calculée au paiement</span></div>
            <div class="summary__row summary__row--total"><span>Total</span><span>${formatPrice(total)}</span></div>
            <button type="button" class="btn btn--primary btn--lg btn--block" id="checkout-btn">Payer ${formatPrice(total)}</button>
            <p class="summary__note">Paiement sécurisé par carte bancaire via Stripe.</p>
          </aside>
        </div>`;
    };
    render();

    root.addEventListener('click', (e) => {
      const checkoutBtn = e.target.closest('#checkout-btn');
      if (checkoutBtn) {
        checkout(checkoutBtn);
        return;
      }
      const item = e.target.closest('.cart-item');
      if (!item) return;
      const id = item.dataset.id;
      const step = e.target.closest('[data-qty]');
      if (step) {
        const input = $('[data-qty-input]', item);
        setQuantity(id, (parseInt(input.value, 10) || 1) + Number(step.dataset.qty));
        render();
      } else if (e.target.closest('[data-remove]')) {
        removeFromCart(id);
        render();
      }
    });

    root.addEventListener('change', (e) => {
      const input = e.target.closest('[data-qty-input]');
      if (!input) return;
      setQuantity(input.closest('.cart-item').dataset.id, parseInt(input.value, 10) || 1);
      render();
    });

    async function checkout(btn) {
      const items = getCart();
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Redirection vers le paiement…';

      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Le paiement est indisponible pour le moment.');

        if (data.demo) {
          const lines = items.map((l) => {
            const p = byId.get(l.id);
            return { name: p.name, quantity: l.quantity, amount: p.price * l.quantity };
          });
          const total = lines.reduce((sum, l) => sum + l.amount, 0);
          localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ items: lines, total }));
        }
        location.href = data.url;
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  // ---------- Confirmation ----------

  async function initSuccess() {
    const root = $('#order');
    const params = new URLSearchParams(location.search);
    clearCart();

    if (params.get('demo')) {
      let order = null;
      try {
        order = JSON.parse(localStorage.getItem(LAST_ORDER_KEY));
      } catch {
        // Pas de récapitulatif disponible.
      }
      localStorage.removeItem(LAST_ORDER_KEY);
      root.innerHTML = `
        <div class="notice"><strong>Mode démonstration :</strong> aucun paiement réel n'a été effectué.</div>
        ${order ? orderLines(order.items, order.total) : ''}`;
      return;
    }

    const sessionId = params.get('session_id');
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/order/${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const order = await res.json();
      root.innerHTML = `
        ${order.email ? `<p>Un reçu a été envoyé à <strong>${escapeHtml(order.email)}</strong>.</p>` : ''}
        ${orderLines(order.items, order.total)}`;
    } catch {
      // Le récapitulatif est facultatif.
    }
  }

  // ---------- Démarrage ----------

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    addToCart(btn.dataset.add, 1);
    toast('Ajouté au panier', { href: '/cart.html', label: 'Voir le panier' });
  });

  document.addEventListener('DOMContentLoaded', async () => {
    updateCartBadge();
    await loadConfig();
    const inits = { home: initHome, product: initProduct, cart: initCart, success: initSuccess };
    const init = inits[document.body.dataset.page];
    if (init) init();
  });
})();
