/* Espace d'administration : connexion, produits, photos, commandes. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const view = $('#view');
  const nav = $('#admin-nav');
  const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

  let status = { configured: false, authenticated: false, paymentsEnabled: false };
  let products = [];

  // ---------- Utilitaires ----------

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.style.background = isError ? 'var(--danger)' : '';
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin${path}`, {
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options,
      body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login' && path !== '/password') {
      status.authenticated = false;
      render();
      throw new Error('Session expirée, reconnectez-vous.');
    }
    if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
    return data;
  }

  function stockTag(stock) {
    if (stock === 0) return '<span class="tag tag--out">Épuisé</span>';
    if (stock <= 3) return `<span class="tag tag--low">Stock : ${stock}</span>`;
    return `<span class="tag tag--ok">Stock : ${stock}</span>`;
  }

  // ---------- Connexion ----------

  function renderAuth() {
    nav.hidden = true;
    const setup = !status.configured;
    view.innerHTML = `
      <form class="auth" id="auth-form">
        <h1>${setup ? 'Bienvenue !' : 'Connexion'}</h1>
        <p>${setup
          ? 'Choisissez le mot de passe qui protégera l\'administration de votre boutique (8 caractères minimum).'
          : 'Entrez votre mot de passe administrateur.'}</p>
        <div class="form">
          <div class="field">
            <label for="pw">Mot de passe</label>
            <input id="pw" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="8" autofocus>
          </div>
          ${setup ? `
          <div class="field">
            <label for="pw2">Confirmez le mot de passe</label>
            <input id="pw2" type="password" autocomplete="new-password" required minlength="8">
          </div>` : ''}
          <button class="btn btn--primary btn--lg" type="submit">${setup ? 'Créer mon mot de passe' : 'Se connecter'}</button>
        </div>
      </form>`;

    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#pw').value;
      if (setup && password !== $('#pw2').value) return toast('Les deux mots de passe ne correspondent pas.', true);
      try {
        await api(setup ? '/setup' : '/login', { method: 'POST', body: { password } });
        status.configured = true;
        status.authenticated = true;
        toast(setup ? 'Mot de passe enregistré. Bienvenue !' : 'Connecté.');
        location.hash = '#produits';
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ---------- Produits : liste ----------

  async function renderProducts() {
    view.innerHTML = '<p class="muted">Chargement…</p>';
    try {
      products = await api('/products');
    } catch (err) {
      view.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      return;
    }

    view.innerHTML = `
      <div class="admin-head">
        <div>
          <h1>Produits</h1>
          <p>${products.length} article${products.length > 1 ? 's' : ''} en boutique. Les flèches changent l'ordre d'affichage.</p>
        </div>
        <a class="btn btn--primary" href="#produit/nouveau">+ Ajouter un produit</a>
      </div>
      <div class="plist" id="plist">
        ${products.length ? products.map((p, i) => `
          <div class="prow" data-id="${escapeHtml(p.id)}">
            <a class="prow__img" href="#produit/${escapeHtml(p.id)}"><img src="${escapeHtml(p.images[0] || '')}" alt=""></a>
            <div>
              <h3 class="prow__name"><a href="#produit/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a></h3>
              <p class="prow__meta">
                <span>${escapeHtml(p.category)}</span>
                <span><strong>${money.format(p.price)}</strong></span>
                ${stockTag(p.stock)}
                <span>${p.images.length} photo${p.images.length > 1 ? 's' : ''}</span>
              </p>
            </div>
            <div class="prow__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
              <button type="button" class="btn btn--ghost btn--sm" data-move="1" ${i === products.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
              <a class="btn btn--ghost btn--sm" href="#produit/${escapeHtml(p.id)}">Modifier</a>
              <button type="button" class="btn btn--danger btn--sm" data-delete>Supprimer</button>
            </div>
          </div>`).join('')
        : '<p class="empty">Aucun produit. Ajoutez-en un !</p>'}
      </div>`;

    $('#plist').addEventListener('click', async (e) => {
      const row = e.target.closest('.prow');
      if (!row) return;
      const id = row.dataset.id;
      const move = e.target.closest('[data-move]');
      const del = e.target.closest('[data-delete]');

      if (move) {
        const ids = products.map((p) => p.id);
        const from = ids.indexOf(id);
        const to = from + Number(move.dataset.move);
        if (to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        try {
          await api('/order', { method: 'PUT', body: { ids } });
          renderProducts();
        } catch (err) {
          toast(err.message, true);
        }
      } else if (del) {
        if (del.dataset.confirm) {
          try {
            await api(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
            toast('Produit supprimé.');
            renderProducts();
          } catch (err) {
            toast(err.message, true);
          }
        } else {
          del.dataset.confirm = '1';
          del.textContent = 'Confirmer la suppression';
          setTimeout(() => { delete del.dataset.confirm; del.textContent = 'Supprimer'; }, 4000);
        }
      }
    });
  }

  // ---------- Produits : formulaire ----------

  async function renderProductForm(id) {
    const isNew = id === 'nouveau';
    let product = { name: '', category: '', price: '', shortDescription: '', description: '', images: [], stock: 10 };
    if (!products.length) {
      try { products = await api('/products'); } catch (err) { return toast(err.message, true); }
    }
    if (!isNew) {
      product = products.find((p) => p.id === id);
      if (!product) {
        view.innerHTML = '<p class="empty">Produit introuvable. <a href="#produits">Retour à la liste</a></p>';
        return;
      }
      product = { ...product, images: [...product.images] };
    }
    let categories = [];
    try {
      categories = (await api('/categories')).map((c) => c.name);
    } catch {
      categories = [...new Set(products.map((p) => p.category))];
    }

    view.innerHTML = `
      <div class="admin-head">
        <div>
          <h1>${isNew ? 'Nouveau produit' : 'Modifier le produit'}</h1>
          <p>${isNew ? 'Renseignez la fiche et ajoutez au moins une photo.' : escapeHtml(product.name)}</p>
        </div>
        <a class="btn btn--ghost" href="#produits">← Retour à la liste</a>
      </div>
      <form class="form form--card" id="pform">
        <div class="form-row">
          <div class="field">
            <label for="f-name">Nom du produit</label>
            <input id="f-name" required maxlength="120" value="${escapeHtml(product.name)}">
          </div>
          <div class="field">
            <label for="f-category">Catégorie</label>
            <input id="f-category" list="categories" maxlength="40" value="${escapeHtml(product.category)}" placeholder="Bracelets, Colliers…">
            <datalist id="categories">${categories.map((c) => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
            <small>Les catégories servent aux filtres de la boutique.</small>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="f-price">Prix TTC (€)</label>
            <input id="f-price" type="number" step="0.01" min="0" required inputmode="decimal" value="${escapeHtml(product.price)}">
          </div>
          <div class="field">
            <label for="f-stock">Stock</label>
            <input id="f-stock" type="number" step="1" min="0" required inputmode="numeric" value="${escapeHtml(product.stock)}">
            <small>0 affiche « Épuisé » et bloque l'achat.</small>
          </div>
        </div>
        <div class="field">
          <label for="f-short">Résumé (une ligne)</label>
          <input id="f-short" maxlength="120" value="${escapeHtml(product.shortDescription)}" placeholder="Olivier massif, fermoir aimanté">
        </div>
        <div class="field">
          <label for="f-desc">Description complète</label>
          <textarea id="f-desc" maxlength="2000">${escapeHtml(product.description)}</textarea>
        </div>
        <div class="field">
          <label>Photos <small>(la première est la photo principale)</small></label>
          <div class="photos" id="photos"></div>
          <label class="dropzone" id="dropzone">
            <input type="file" id="f-files" accept="image/*" multiple>
            <strong>Ajouter des photos</strong> : cliquez ou glissez vos images ici.<br>
            <small>JPG, PNG ou WebP, redimensionnées automatiquement.</small>
          </label>
        </div>
        <div class="form-actions">
          <button class="btn btn--primary btn--lg" type="submit">${isNew ? 'Créer le produit' : 'Enregistrer'}</button>
          <a class="btn btn--ghost" href="#produits">Annuler</a>
          <span class="spacer"></span>
          ${isNew ? '' : `<a class="btn btn--ghost btn--sm" href="/product.html?id=${encodeURIComponent(product.id)}" target="_blank" rel="noopener">Voir dans la boutique ↗</a>`}
        </div>
      </form>`;

    const photosEl = $('#photos');
    const renderPhotos = () => {
      photosEl.innerHTML = product.images.map((src, i) => `
        <div class="photo" data-index="${i}">
          <img src="${escapeHtml(src)}" alt="">
          ${i === 0 ? '<span class="photo__tag">Principale</span>' : ''}
          <div class="photo__actions">
            <button type="button" data-photo="up" title="Mettre avant" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="del" data-photo="del" title="Retirer">✕</button>
          </div>
        </div>`).join('') || '<p class="muted">Aucune photo pour l\'instant.</p>';
    };
    renderPhotos();

    photosEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-photo]');
      if (!btn) return;
      const i = Number(btn.closest('.photo').dataset.index);
      if (btn.dataset.photo === 'del') product.images.splice(i, 1);
      else if (i > 0) product.images.splice(i - 1, 0, product.images.splice(i, 1)[0]);
      renderPhotos();
    });

    const dropzone = $('#dropzone');
    const fileInput = $('#f-files');
    const uploadFiles = async (files) => {
      if (!files.length) return;
      const form = new FormData();
      Array.from(files).slice(0, 10).forEach((f) => form.append('photos', f));
      dropzone.classList.add('is-busy');
      toast(`Envoi de ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      try {
        const data = await api('/upload', { method: 'POST', body: form });
        product.images.push(...data.images);
        renderPhotos();
        toast('Photos ajoutées. Pensez à enregistrer.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        dropzone.classList.remove('is-busy');
        fileInput.value = '';
      }
    };
    fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
    dropzone.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));

    $('#pform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('#f-name').value,
        category: $('#f-category').value,
        price: $('#f-price').value,
        stock: $('#f-stock').value,
        shortDescription: $('#f-short').value,
        description: $('#f-desc').value,
        images: product.images,
      };
      try {
        await api(isNew ? '/products' : `/products/${encodeURIComponent(product.id)}`, { method: isNew ? 'POST' : 'PUT', body });
        products = [];
        toast(isNew ? 'Produit créé.' : 'Modifications enregistrées.');
        location.hash = '#produits';
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ---------- Catégories ----------

  async function renderCategories() {
    view.innerHTML = '<p class="muted">Chargement…</p>';
    let categories;
    try {
      categories = await api('/categories');
    } catch (err) {
      view.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      return;
    }

    view.innerHTML = `
      <div class="admin-head">
        <div>
          <h1>Catégories</h1>
          <p>L'ordre ci-dessous est celui des filtres de la boutique. Renommer une catégorie s'applique à tous ses produits ; donner le nom d'une catégorie existante fusionne les deux. Une catégorie vide n'apparaît pas dans la boutique tant qu'elle n'a pas de produit.</p>
        </div>
      </div>
      <form class="form form--card cat-add" id="cat-add">
        <div class="field">
          <label for="cat-new">Nouvelle catégorie</label>
          <div class="cat-add__row">
            <input id="cat-new" maxlength="40" required placeholder="Par exemple : Broches">
            <button class="btn btn--primary" type="submit">+ Ajouter</button>
          </div>
        </div>
      </form>
      <div class="plist" id="clist">
        ${categories.length ? categories.map((c, i) => `
          <form class="prow prow--cat" data-from="${escapeHtml(c.name)}">
            <div>
              <h3 class="prow__name">${escapeHtml(c.name)}</h3>
              <p class="prow__meta"><span>${c.count ? `${c.count} produit${c.count > 1 ? 's' : ''}` : 'Aucun produit (invisible dans la boutique)'}</span></p>
            </div>
            <div class="prow__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
              <button type="button" class="btn btn--ghost btn--sm" data-move="1" ${i === categories.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
              <input class="cat-input" value="${escapeHtml(c.name)}" maxlength="40" aria-label="Nouveau nom" list="cat-names">
              <button class="btn btn--primary btn--sm" type="submit">Renommer</button>
              ${c.count === 0 ? '<button type="button" class="btn btn--danger btn--sm" data-delete>Supprimer</button>' : ''}
            </div>
          </form>`).join('')
        : '<p class="empty">Aucune catégorie pour l\'instant.</p>'}
      </div>
      <datalist id="cat-names">${categories.map((c) => `<option value="${escapeHtml(c.name)}">`).join('')}</datalist>`;

    $('#cat-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/categories', { method: 'POST', body: { name: $('#cat-new').value } });
        toast(`Catégorie « ${data.name} » ajoutée.`);
        renderCategories();
      } catch (err) {
        toast(err.message, true);
      }
    });

    $('#clist').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target.closest('.prow--cat');
      const from = form.dataset.from;
      const to = $('.cat-input', form).value.trim();
      if (!to || to === from) return;
      try {
        const data = await api('/categories', { method: 'PUT', body: { from, to } });
        products = [];
        toast(data.merged ? `Fusionnée : ${data.updated} produit${data.updated > 1 ? 's' : ''} déplacé${data.updated > 1 ? 's' : ''}.` : `Catégorie renommée en « ${to} ».`);
        renderCategories();
      } catch (err) {
        toast(err.message, true);
      }
    });

    $('#clist').addEventListener('click', async (e) => {
      const form = e.target.closest('.prow--cat');
      if (!form) return;
      const name = form.dataset.from;
      const move = e.target.closest('[data-move]');
      const del = e.target.closest('[data-delete]');
      try {
        if (move) {
          const names = categories.map((c) => c.name);
          const from = names.indexOf(name);
          const to = from + Number(move.dataset.move);
          if (to < 0 || to >= names.length) return;
          names.splice(to, 0, names.splice(from, 1)[0]);
          await api('/categories/order', { method: 'PUT', body: { names } });
          renderCategories();
        } else if (del) {
          await api(`/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
          toast('Catégorie supprimée.');
          renderCategories();
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ---------- Commandes ----------

  function formatAddress(shipping) {
    const a = shipping?.address;
    if (!a) return '';
    return [shipping.name, a.line1, a.line2, `${a.postal_code || ''} ${a.city || ''}`.trim(), a.country].filter(Boolean).join('\n');
  }

  async function renderOrders() {
    view.innerHTML = '<p class="muted">Chargement…</p>';
    let data;
    try {
      data = await api('/orders');
    } catch (err) {
      view.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      return;
    }
    const note = data.source === 'stripe'
      ? 'Les 50 dernières commandes payées, lues directement depuis Stripe.'
      : status.paymentsEnabled
        ? 'Commandes enregistrées par le webhook Stripe.'
        : 'Stripe n\'est pas encore activé : les commandes apparaîtront ici une fois la clé renseignée.';

    view.innerHTML = `
      <div class="admin-head">
        <div><h1>Commandes</h1><p>${note}</p></div>
      </div>
      <div class="orders">
        ${data.orders.length ? data.orders.map((o) => `
          <article class="order">
            <div class="order__head">
              <strong>${money.format(o.total)}</strong>
              <span>${escapeHtml(o.name || o.email || 'Client')}${o.name && o.email ? ` · ${escapeHtml(o.email)}` : ''}</span>
              <span class="tag ${o.status === 'paid' ? 'tag--ok' : 'tag--low'}">${o.status === 'paid' ? 'Payée' : escapeHtml(o.status)}</span>
              <span class="order__date">${dateFmt.format(new Date(o.date))}</span>
            </div>
            <div class="order__body">
              ${o.items?.length ? `<div><h4>Articles</h4><ul>${o.items.map((it) => `<li>${escapeHtml(it.name)} × ${it.quantity} — ${money.format(it.amount)}</li>`).join('')}</ul></div>` : ''}
              ${formatAddress(o.shipping) ? `<div><h4>Livraison</h4><address>${escapeHtml(formatAddress(o.shipping))}</address></div>` : ''}
            </div>
          </article>`).join('')
        : '<p class="empty">Aucune commande pour le moment.</p>'}
      </div>`;
  }

  // ---------- Mot de passe ----------

  function renderAccount() {
    view.innerHTML = `
      <div class="admin-head"><div><h1>Mot de passe</h1><p>Changez le mot de passe de l'administration.</p></div></div>
      <form class="form form--card form--narrow" id="pwform">
        <div class="field"><label for="cur">Mot de passe actuel</label><input id="cur" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="new1">Nouveau mot de passe</label><input id="new1" type="password" autocomplete="new-password" required minlength="8"></div>
        <div class="field"><label for="new2">Confirmez le nouveau mot de passe</label><input id="new2" type="password" autocomplete="new-password" required minlength="8"></div>
        <div class="form-actions"><button class="btn btn--primary" type="submit">Changer le mot de passe</button></div>
      </form>`;
    $('#pwform').addEventListener('submit', async (e) => {
      e.preventDefault();
      if ($('#new1').value !== $('#new2').value) return toast('Les deux nouveaux mots de passe ne correspondent pas.', true);
      try {
        await api('/password', { method: 'POST', body: { current: $('#cur').value, next: $('#new1').value } });
        toast('Mot de passe modifié.');
        location.hash = '#produits';
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ---------- Navigation ----------

  function render() {
    if (!status.authenticated) return renderAuth();
    nav.hidden = false;
    const [route, arg] = location.hash.replace(/^#/, '').split('/');
    $$('[data-nav]', nav).forEach((a) => a.classList.toggle('is-active', a.dataset.nav === (route || 'produits') || (route === 'produit' && a.dataset.nav === 'produits')));
    if (route === 'produit' && arg) return renderProductForm(decodeURIComponent(arg));
    if (route === 'categories') return renderCategories();
    if (route === 'commandes') return renderOrders();
    if (route === 'compte') return renderAccount();
    return renderProducts();
  }

  window.addEventListener('hashchange', render);

  $('#logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    status.authenticated = false;
    location.hash = '';
    render();
  });

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      status = await api('/status');
    } catch {
      view.innerHTML = '<p class="empty">Impossible de joindre le serveur.</p>';
      return;
    }
    render();
  });
})();
