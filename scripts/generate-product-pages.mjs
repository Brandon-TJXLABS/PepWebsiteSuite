#!/usr/bin/env node
// MANUAL TOOL — not part of any build/deploy step. Run by hand after any
// product add/edit/price/stock change in admin.html, before pushing to
// main. See docs/SEO_PRODUCT_PAGES.md.
//
//   node scripts/generate-product-pages.mjs
//
// In one run: regenerates every product-<slug>.html at the repo root
// (deleting any stale ones first) AND rewrites sitemap.xml from the same
// product list, so the two never drift out of sync. Does not touch
// robots.txt (static, hand-written once) or any hand-written page.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://acionaco.com';
const LOW_STOCK_THRESHOLD = 5;

// A generated page's filename always starts with "product-" but must never
// match product-request.html, the one hand-written page that also starts
// with that prefix.
const GENERATED_PRODUCT_REGEX = /^product-(?!request\.html$).+\.html$/;

// ---------- Supabase config, read from the checked-in client file so ----
// there's exactly one place the URL/anon key live (see docs/ROADMAP.md's
// still-open key-rotation item — if that key is ever rotated, this script
// picks up the new value automatically, nothing to update here).
function readSupabaseConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'supabaseClient.js'), 'utf8');
  const url = src.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
  const key = src.match(/SUPABASE_KEY\s*=\s*'([^']+)'/)?.[1];
  if (!url || !key) {
    throw new Error('Could not read SUPABASE_URL/SUPABASE_KEY from js/supabaseClient.js');
  }
  return { url, key };
}

async function fetchActiveProducts({ url, key }) {
  const res = await fetch(`${url}/rest/v1/products?select=*&active=eq.true&order=name.asc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Derives a stable, readable slug from the existing unique `sku` column —
// no new DB column needed. AC-BPC157 -> bpc-157, AC-TB500 -> tb-500,
// AC-GHKCU -> ghkcu, etc.
function slugify(sku) {
  let s = sku.trim().toLowerCase();
  s = s.replace(/^ac-/, '');
  s = s.replace(/^([a-z]+)(\d+)$/, '$1-$2');
  s = s.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s;
}

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2) + ' AUD';
}

function formatRestockDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Mirrors js/products.js's acionaStockStatus() — kept in sync manually
// since this script runs in Node, not the browser, and can't import that
// file directly.
function stockStatus(p) {
  const qty = (p.stock_quantity !== undefined && p.stock_quantity !== null)
    ? p.stock_quantity
    : (p.in_stock === false ? 0 : null);
  const outOfStock = qty !== null && qty <= 0;
  const lowStock = !outOfStock && qty !== null && qty <= LOW_STOCK_THRESHOLD;
  return { qty, outOfStock, lowStock };
}

// Defends against stray whitespace/newlines baked into DB string columns
// (seen for real: a product's image_url had a trailing \r\n, which broke
// the og:image tag, JSON-LD, and <img> src by splitting the URL across
// lines). Applied to every free-text/URL column before it's embedded.
function clean(s) {
  return (s || '').trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// No dedicated OG/social-share image exists yet in the repo — falls back
// to the homepage hero photo, matching how index.html itself references it.
const FALLBACK_IMAGE_REL = 'images/Heroimage%233.png';

function collisionCheck(products, reservedFilenames) {
  const seen = new Map();
  for (const p of products) {
    const slug = slugify(p.sku);
    const filename = `product-${slug}.html`;
    if (reservedFilenames.has(filename)) {
      throw new Error(`Generated filename "${filename}" (from SKU "${p.sku}") collides with an existing hand-written page. Rename the SKU or resolve manually.`);
    }
    if (seen.has(slug)) {
      throw new Error(`SKU slug collision: "${p.sku}" and "${seen.get(slug)}" both slugify to "${slug}".`);
    }
    seen.set(slug, p.sku);
  }
}

// Pulls richer content (chemical identifiers table, research-literature
// topic list, storage & handling) directly from the product's matching
// wiki-*.html page, keeping the wiki page as the single source of truth —
// no schema change, no hand-duplicated content. Verified all existing
// wiki pages share byte-identical heading text/markup shape, so a regex
// keyed on that heading text is reliable. Returns null if wikiUrl isn't
// set, the file doesn't exist, or nothing could be extracted — every
// caller treats a missing section as "just omit it", never an error.
function extractWikiSections(wikiUrl) {
  if (!wikiUrl) return null;
  const filePath = path.join(ROOT, path.basename(wikiUrl));
  if (!fs.existsSync(filePath)) return null;

  const src = fs.readFileSync(filePath, 'utf8');
  const sections = {};

  const identifiersMatch = src.match(/<h2[^>]*>Chemical identifiers<\/h2>\s*(<table class="results"[^>]*>[\s\S]*?<\/table>)/);
  if (identifiersMatch) sections.identifiers = identifiersMatch[1];

  const researchMatch = src.match(/<h2[^>]*>Studied in the research literature for<\/h2>\s*(<p[^>]*>[\s\S]*?<\/p>)\s*(<ul[^>]*>[\s\S]*?<\/ul>)/);
  if (researchMatch) sections.researchAreas = { disclaimer: researchMatch[1], list: researchMatch[2] };

  const storageMatch = src.match(/<h2[^>]*>Storage &amp; handling<\/h2>\s*(<ul[^>]*>[\s\S]*?<\/ul>)/);
  if (storageMatch) sections.storage = storageMatch[1];

  return Object.keys(sections).length > 0 ? sections : null;
}

function renderProductPage(p) {
  const name = clean(p.name);
  const sku = clean(p.sku);
  const purity = clean(p.purity);
  const batchCode = clean(p.batch_code);
  const imageUrl = clean(p.image_url) || null;
  const coaUrl = clean(p.coa_url) || null;
  const wikiUrl = clean(p.wiki_url) || null;

  const slug = slugify(sku);
  const url = `${SITE_URL}/product-${slug}`;
  const title = `${name} — ${purity || 'Research Peptide'} — Aciona`;
  const rawDesc = clean(p.description) || `${name}, third-party tested research peptide. Batch ${batchCode || 'TBD'}, ${purity || 'purity on COA'}.`;
  const metaDesc = rawDesc.length > 155 ? rawDesc.slice(0, 152) + '…' : rawDesc;
  const imageRel = imageUrl || FALLBACK_IMAGE_REL;
  const imageAbs = imageUrl || `${SITE_URL}/${FALLBACK_IMAGE_REL}`;
  const priceDecimal = (p.price_cents / 100).toFixed(2);
  const { qty, outOfStock, lowStock } = stockStatus(p);
  const wikiSections = extractWikiSections(wikiUrl);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    sku,
    description: rawDesc,
    ...(imageUrl ? { image: imageUrl } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'AUD',
      price: priceDecimal,
      availability: outOfStock ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      url
    }
  };
  // Neutralize "<" so a "</script>" inside a description can never break
  // out of the JSON-LD script tag.
  const jsonLdString = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  const buyBoxHtml = outOfStock
    ? `<button class="btn btn-outline" disabled>Out of stock</button>${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}`
    : `<button class="btn btn-primary" style="width:100%; justify-content:center;" onclick="acionaAddToCart('${p.id}')">Add to cart</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(metaDesc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Aciona">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(metaDesc)}">
<meta property="og:image" content="${imageAbs}">
<meta property="og:url" content="${url}">
<script type="application/ld+json">${jsonLdString}</script>
<link rel="stylesheet" href="styles.css">
</head>
<body>

<!-- AUTO-GENERATED by scripts/generate-product-pages.mjs — do not hand-edit.
     Re-run the script instead: see docs/SEO_PRODUCT_PAGES.md -->

<header class="site">
  <nav class="nav">
    <a href="/" class="brand"><svg width="22" height="22" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M17,66 A35,35 0 1 1 83,66" style="stroke:var(--blue-deep);" stroke-width="6.5" stroke-linecap="round" fill="none"/><polygon points="50,16 26,71 74,71" style="fill:var(--blue-deep);"/><circle cx="50" cy="80.5" r="5.5" style="fill:var(--blue-deep);"/></svg> Aciona</a>
    <button class="nav-toggle" onclick="acionaToggleNav()" aria-label="Menu">☰</button>
    <ul class="navlinks" id="nav-links">
      <li><a href="shop">Shop</a></li>
      <li><a href="about">About</a></li>
      <li><a href="lab-results">Lab Results</a></li>
      <li><a href="product-request">Request a Product</a></li>
      <li><a href="contact">Contact</a></li>
      <li><a href="cart">Cart <span id="cart-count" class="cart-badge"></span></a></li>
      <li><a href="login" id="nav-account">Login</a></li>
    </ul>
  </nav>
</header>

<section class="hero" style="padding-bottom:0;">
  <div class="wrap">
    <div class="eyebrow">${escapeHtml(sku)}</div>
    <h1>${escapeHtml(name)}</h1>
  </div>
</section>

<section style="padding-top:24px;">
  <div class="wrap" id="product-page" data-product-id="${p.id}" style="max-width:900px;">
    <div class="modal-content" style="border:1px solid var(--line); border-radius:6px; overflow:hidden;">
      <div class="modal-image">
        <img class="modal-image-bg" src="${imageRel}" alt="" aria-hidden="true">
        <img class="modal-image-fg" src="${imageRel}" alt="${escapeAttr(name)}">
      </div>
      <div class="modal-details">
        ${outOfStock ? `<div class="stock-badge" style="position:static; display:inline-block; margin-bottom:10px;">Out of stock</div>` : ''}
        ${lowStock ? `<div class="stock-badge low" style="position:static; display:inline-block; margin-bottom:10px;">Only ${qty} left</div>` : ''}
        ${p.show_research_banner !== false ? `<div class="research-banner">⚠ For research use only</div>` : ''}
        <p style="color:var(--ink-soft);">${escapeHtml(rawDesc)}</p>

        <div class="coa-row"><span class="label">Purity (HPLC)</span><span class="value">${escapeHtml(purity || '—')}</span></div>
        <div class="coa-row"><span class="label">Batch</span><span class="value">${escapeHtml(batchCode || '—')}</span></div>
        <div class="coa-row"><span class="label">Price</span><span class="value" id="product-live-price">${formatPrice(p.price_cents)}</span></div>

        ${coaUrl ? `<a href="${coaUrl}" target="_blank" rel="noopener" class="coa-link" style="display:inline-block; margin-top:12px;">View Certificate of Analysis →</a>` : ''}
        ${wikiUrl ? `<a href="${wikiUrl}" class="coa-link" style="display:inline-block; margin-top:12px; margin-left:16px;">Research reference →</a>` : ''}

        <div id="product-buy-box" style="margin-top:20px;">
          ${buyBoxHtml}
        </div>
      </div>
    </div>

    ${wikiSections ? `<div class="wiki-extract" style="margin-top:32px;">
      ${wikiSections.identifiers ? `<h2 style="font-size:1.15rem; color:var(--blue-deep);">Chemical identifiers</h2>${wikiSections.identifiers}` : ''}
      ${wikiSections.researchAreas ? `<h2 style="font-size:1.15rem; color:var(--blue-deep); margin-top:24px;">Studied in the research literature for</h2>${wikiSections.researchAreas.disclaimer}${wikiSections.researchAreas.list}` : ''}
      ${wikiSections.storage ? `<h2 style="font-size:1.15rem; color:var(--blue-deep); margin-top:24px;">Storage &amp; handling</h2>${wikiSections.storage}` : ''}
    </div>` : ''}

    <p style="margin-top:24px;"><a href="shop">← Back to all products</a></p>

    <div class="disclaimer" style="margin:36px 0;">
      <strong>Research use only.</strong> This product is sold for laboratory research purposes only. Not a drug, dietary supplement, or cosmetic, and not intended for human or animal consumption.
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div class="brand" style="margin-bottom:10px;"><svg width="22" height="22" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M17,66 A35,35 0 1 1 83,66" style="stroke:var(--blue-deep);" stroke-width="6.5" stroke-linecap="round" fill="none"/><polygon points="50,16 26,71 74,71" style="fill:var(--blue-deep);"/><circle cx="50" cy="80.5" r="5.5" style="fill:var(--blue-deep);"/></svg> Aciona</div>
        <p style="color:var(--ink-soft); font-size:.9rem; max-width:36ch;">Third-party verified research peptides, with a published Certificate of Analysis on every batch.</p>
        <p style="color:var(--blue-mid); font-size:.78rem; letter-spacing:.03em; margin-top:4px;">Pure by design. Powered by purpose.</p>
      </div>
      <div>
        <h4>Site</h4>
        <ul>
          <li><a href="shop">Shop</a></li>
          <li><a href="about">About us</a></li>
          <li><a href="lab-results">Lab results</a></li>
          <li><a href="faq">FAQ</a></li>
          <li><a href="product-request">Request a product</a></li>
          <li><a href="contact">Contact</a></li>
        </ul>
      </div>
      <div>
        <h4>Legal</h4>
        <ul>
          <li><a href="terms">Terms of Service</a></li>
          <li><a href="privacy">Privacy Policy</a></li>
          <li><a href="refund-policy">Shipping &amp; Refunds</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="mailto:hello@acionaco.com">hello@acionaco.com</a></li>
          <li>Mon–Fri, 9am–5pm</li>
          <li>Sydney, NSW 2000 Australia</li>
        </ul>
      </div>
    </div>
    <div class="disclaimer" style="margin-bottom:20px;">
      <strong>Disclaimer:</strong> All products sold on this website are intended strictly for in-vitro research and laboratory use only. They are not intended for human consumption and are not to be used as drugs, dietary supplements, food additives, or cosmetics. These products have not been evaluated or approved by the Therapeutic Goods Administration (TGA), the Food and Drug Administration (FDA), or any other regulatory authority for human use. The purchaser acknowledges that they are 18 years of age or older and that all products purchased are for legitimate research purposes only. AcionaCo Aus assumes no liability for the misuse of any product sold on this website.
    </div>
    <div class="footer-bottom">
      <span>© 2026 Aciona. All rights reserved.</span>
      <span>For laboratory research use only.</span>
    </div>
  </div>
</footer>

<div class="payment-strip">
  <div class="wrap">
    <span>We accept:</span>
    <span class="payment-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><polygon points="12 2 20 7 4 7"/><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/></svg> Bank Transfer</span>
    <span class="payment-badge"><img src="images/payid-brandmark-black.png" alt="PayID" style="height:16px; width:auto; vertical-align:middle;"></span>
    <span style="flex-basis:100%; font-size:.68rem; color:var(--ink-soft);">PayID&reg; is a registered trademark of NPP Australia Limited.</span>
  </div>
</div>

<script src="js/age-gate.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/supabaseClient.js"></script>
<script src="js/nav.js"></script>
<script src="js/auth.js"></script>
<script src="js/analytics.js"></script>
<script src="js/cart.js"></script>
<script src="js/shipping.js"></script>
<script src="js/products.js"></script>

<!-- Cart drawer (side sheet) -->
<div class="drawer-overlay" id="cart-drawer-overlay" onclick="if(event.target === this) acionaCloseCartDrawer()">
  <div class="drawer-panel">
    <div class="drawer-head">
      <h3>Your cart</h3>
      <button class="modal-close" onclick="acionaCloseCartDrawer()" aria-label="Close" style="position:static;">×</button>
    </div>
    <div class="drawer-body" id="cart-drawer-body"></div>
    <div class="drawer-footer" id="cart-drawer-footer" style="display:none;"></div>
  </div>
</div>

</body>
</html>
`;
}

function writeSitemap(products) {
  const today = new Date().toISOString().slice(0, 10);

  const productUrls = products.map(p => ({
    loc: `${SITE_URL}/product-${slugify(p.sku)}`,
    lastmod: today
  }));

  // Auto-discovered so a new wiki-*.html page needs no script edit — see
  // docs/ROADMAP.md's "duplicate the file, rename it" wiki-page process.
  const wikiUrls = fs.readdirSync(ROOT)
    .filter(f => /^wiki-.*\.html$/.test(f))
    .map(f => ({ loc: `${SITE_URL}/${f.replace(/\.html$/, '')}` }));

  // Explicit allowlist, not a denylist — a new sensitive page added later
  // without updating this list is excluded by default (fail-closed).
  const STATIC_PUBLIC_PAGES = [
    'shop', 'about', 'faq', 'contact', 'product-request',
    'lab-results', 'terms', 'privacy', 'refund-policy'
  ];
  const staticUrls = STATIC_PUBLIC_PAGES.map(p => ({ loc: `${SITE_URL}/${p}` }));

  const allUrls = [{ loc: `${SITE_URL}/` }, ...productUrls, ...wikiUrls, ...staticUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>\n    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`).join('\n')}
</urlset>
`;

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
  return allUrls.length;
}

async function main() {
  const config = readSupabaseConfig();
  const products = await fetchActiveProducts(config);

  const reservedFilenames = new Set(
    fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !GENERATED_PRODUCT_REGEX.test(f))
  );
  collisionCheck(products, reservedFilenames);

  const stale = fs.readdirSync(ROOT).filter(f => GENERATED_PRODUCT_REGEX.test(f));
  for (const f of stale) fs.unlinkSync(path.join(ROOT, f));

  const written = [];
  for (const p of products) {
    const filename = `product-${slugify(p.sku)}.html`;
    fs.writeFileSync(path.join(ROOT, filename), renderProductPage(p));
    written.push(filename);
  }

  const sitemapCount = writeSitemap(products);

  console.log(`Deleted ${stale.length} stale product page(s).`);
  console.log(`Wrote ${written.length} product page(s):`);
  for (const f of written) console.log(`  ${f}`);
  console.log(`Wrote sitemap.xml (${sitemapCount} URLs).`);
  console.log('\nReview the diff, then git add / commit / push.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
