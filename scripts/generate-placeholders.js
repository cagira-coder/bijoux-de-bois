'use strict';

// Génère des images SVG de démonstration pour chaque produit du catalogue.
//
//   Usage : npm run images
//
// Remplacez ensuite les fichiers de public/images/products/ par vos vraies photos
// (JPG ou PNG, idéalement carrées, 1000 × 1000 px) et mettez à jour les chemins
// dans data/products.json. Le script ne touche qu'aux fichiers .svg.

const fs = require('fs');
const path = require('path');

const products = require('../data/products.json');
const outDir = path.join(__dirname, '..', 'public', 'images', 'products');
fs.mkdirSync(outDir, { recursive: true });

// Teintes inspirées de chaque essence de bois.
const palettes = {
  'bracelet-olivier': { bg: '#f3ead8', ink: '#8a6a2f' },
  'pendentif-noyer': { bg: '#efe3d6', ink: '#5b3a29' },
  'boucles-erable': { bg: '#f6efe0', ink: '#a37a3c' },
  'bague-ebene': { bg: '#e9e4df', ink: '#2b2420' },
  'collier-perles-hetre': { bg: '#f4e9dc', ink: '#9a6b3a' },
  'jonc-frene': { bg: '#f1ede2', ink: '#7c6a4a' },
  'barrette-cerisier': { bg: '#f5e5dd', ink: '#9c4a2e' },
  'coffret-cadeau': { bg: '#ede7dc', ink: '#6f5a2b' },
};
const defaultPalette = { bg: '#eeeeee', ink: '#555555' };

function beads(c) {
  let out = `<path d="M220 300 A180 180 0 0 0 580 300" fill="none" stroke="${c}" stroke-width="4" opacity="0.6"/>
    <path d="M220 300 v-60 M580 300 v-60" stroke="${c}" stroke-width="4" opacity="0.6" stroke-linecap="round"/>`;
  for (let i = 0; i <= 10; i += 1) {
    const t = Math.PI * (0.08 + (0.84 * i) / 10);
    const x = 400 + 180 * Math.cos(t);
    const y = 300 + 180 * Math.sin(t);
    const r = 16 + 14 * Math.sin(t);
    out += `
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#ffffff" fill-opacity="0.55" stroke="${c}" stroke-width="7"/>`;
  }
  return out;
}

const earring = (c) => `
      <path d="M400 240 C 400 200, 360 190, 370 160 C 380 140, 410 150, 400 180" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
      <path d="M400 240 C 340 330, 340 450, 400 480 C 460 450, 460 330, 400 240 Z" fill="#ffffff" fill-opacity="0.5" stroke="${c}" stroke-width="12"/>
      <path d="M400 300 v140" stroke="${c}" stroke-width="5" opacity="0.45" stroke-linecap="round"/>
      <path d="M375 380 q25 -20 50 0" fill="none" stroke="${c}" stroke-width="4" opacity="0.4" stroke-linecap="round"/>`;

const icons = {
  'bracelet-olivier': (c) => `
    <circle cx="400" cy="400" r="150" fill="none" stroke="${c}" stroke-width="44"/>
    <circle cx="400" cy="400" r="150" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.35"/>
    <path d="M292 340 q40 -22 82 -4 M318 478 q48 26 98 2" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.55" stroke-linecap="round"/>
    <circle cx="400" cy="250" r="17" fill="#e8d5b5" stroke="${c}" stroke-width="7"/>`,
  'pendentif-noyer': (c) => `
    <path d="M250 180 L400 405 L550 180" fill="none" stroke="${c}" stroke-width="7" stroke-dasharray="2 13" stroke-linecap="round"/>
    <circle cx="400" cy="415" r="14" fill="${c}"/>
    <circle cx="400" cy="505" r="92" fill="#ffffff" fill-opacity="0.5" stroke="${c}" stroke-width="12"/>
    <path d="M335 505 q65 -55 130 0 M345 540 q55 -45 110 0 M352 470 q48 -38 96 0" fill="none" stroke="${c}" stroke-width="5" opacity="0.45" stroke-linecap="round"/>`,
  'boucles-erable': (c) => `
    <g transform="translate(-95 0)">${earring(c)}</g>
    <g transform="translate(95 0)">${earring(c)}</g>`,
  'bague-ebene': (c) => `
    <ellipse cx="400" cy="450" rx="130" ry="110" fill="none" stroke="${c}" stroke-width="36"/>
    <ellipse cx="400" cy="450" rx="130" ry="110" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.25"/>
    <rect x="358" y="292" width="84" height="62" rx="14" fill="#d9d9de" stroke="${c}" stroke-width="10"/>
    <circle cx="400" cy="323" r="13" fill="#ffffff" opacity="0.85"/>`,
  'collier-perles-hetre': (c) => beads(c),
  'jonc-frene': (c) => `
    <circle cx="400" cy="400" r="165" fill="none" stroke="${c}" stroke-width="18"/>
    <circle cx="400" cy="400" r="165" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.45"/>
    <path d="M262 330 q-28 70 -4 140" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.6" stroke-linecap="round"/>`,
  'barrette-cerisier': (c) => `
    <g transform="rotate(-20 400 400)">
      <rect x="220" y="360" width="360" height="80" rx="40" fill="#ffffff" fill-opacity="0.5" stroke="${c}" stroke-width="12"/>
      <path d="M262 400 h276" stroke="${c}" stroke-width="5" opacity="0.45" stroke-linecap="round"/>
      <path d="M250 385 q60 -12 120 0 M400 415 q60 12 120 0" fill="none" stroke="${c}" stroke-width="4" opacity="0.4" stroke-linecap="round"/>
      <rect x="330" y="455" width="140" height="14" rx="7" fill="${c}" opacity="0.7"/>
    </g>`,
  'coffret-cadeau': (c) => `
    <rect x="250" y="340" width="300" height="220" rx="14" fill="#ffffff" fill-opacity="0.5" stroke="${c}" stroke-width="12"/>
    <rect x="235" y="290" width="330" height="70" rx="12" fill="${c}"/>
    <rect x="382" y="290" width="36" height="270" fill="#ffffff" opacity="0.6"/>
    <path d="M400 288 c-40 -70 -110 -40 -60 2 M400 288 c40 -70 110 -40 60 2" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`,
};

// Produit sans icône dédiée : on affiche sa première lettre.
const letterIcon = (product) => (c) => `
    <circle cx="400" cy="400" r="170" fill="${c}" opacity="0.15"/>
    <text x="400" y="462" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="180" font-weight="700" fill="${c}">${escapeXml(product.name.charAt(0).toUpperCase())}</text>`;

const views = [
  { label: 'Vue de face', transform: '' },
  { label: 'Vue de côté', transform: 'rotate(-10 400 400)' },
  { label: 'Détail', transform: 'translate(400 380) scale(1.35) translate(-400 -400)' },
];

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function svgFor(product, viewIndex) {
  const { bg, ink } = palettes[product.id] || defaultPalette;
  const view = views[Math.min(viewIndex, views.length - 1)];
  const icon = (icons[product.id] || letterIcon(product))(ink);
  const font = 'Segoe UI, Helvetica, Arial, sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.65"/>
      <stop offset="1" stop-color="${ink}" stop-opacity="0.14"/>
    </linearGradient>
    <clipPath id="zone"><rect x="0" y="0" width="800" height="660"/></clipPath>
  </defs>
  <rect width="800" height="800" fill="${bg}"/>
  <rect width="800" height="800" fill="url(#g)"/>
  <g clip-path="url(#zone)"><g transform="${view.transform}">${icon}
  </g></g>
  <text x="400" y="706" text-anchor="middle" font-family="${font}" font-size="34" font-weight="600" fill="${ink}">${escapeXml(product.name)}</text>
  <text x="400" y="746" text-anchor="middle" font-family="${font}" font-size="22" fill="${ink}" opacity="0.7">${view.label} · image de démonstration</text>
</svg>
`;
}

let count = 0;
for (const product of products) {
  (product.images || []).forEach((imagePath, index) => {
    if (!imagePath.startsWith('/images/products/') || !imagePath.endsWith('.svg')) return;
    fs.writeFileSync(path.join(outDir, path.basename(imagePath)), svgFor(product, index));
    count += 1;
  });
}

console.log(`${count} image(s) générée(s) dans ${path.relative(process.cwd(), outDir)}`);
