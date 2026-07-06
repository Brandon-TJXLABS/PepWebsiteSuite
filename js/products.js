// Loads products from Supabase and renders them into #products-grid on index.html
// Clicking a card opens a quick-view modal with more detail.

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2) + ' USD';
}

function formatRestockDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// PLACEHOLDER_IMAGE_SVG is defined in cart.js (loaded before this file on
// every page that uses it) and reused here rather than duplicated.

const LOW_STOCK_THRESHOLD = 5;

let acionaProducts = [];

// Works out stock status whether or not the stock_quantity migration has
// been run yet, so this never breaks against an older database.
function acionaStockStatus(p) {
  const qty = (p.stock_quantity !== undefined && p.stock_quantity !== null)
    ? p.stock_quantity
    : (p.in_stock === false ? 0 : null); // null = unknown/unlimited, treat as in stock

  const outOfStock = qty !== null && qty <= 0;
  const lowStock = !outOfStock && qty !== null && qty <= LOW_STOCK_THRESHOLD;
  return { qty, outOfStock, lowStock };
}

async function acionaLoadProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  const { data: products, error } = await supabaseClient
    .from('products')
    .select('*')
    .eq('active', true)
    .order('name');

  if (error) {
    grid.innerHTML = '<p style="color:var(--ink-soft);">Could not load products right now.</p>';
    console.error(error);
    return;
  }

  acionaProducts = products;
  acionaRenderProductGrid(products);
}

// Applies the search box + sort select (if present on the page) to the
// already-fetched acionaProducts array and re-renders — no extra query,
// since the catalog is small enough to filter/sort entirely client-side.
function acionaApplyFiltersAndSort() {
  const searchEl = document.getElementById('product-search');
  const sortEl = document.getElementById('product-sort');
  const search = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const sortBy = sortEl ? sortEl.value : 'name';

  let filtered = acionaProducts;
  if (search) {
    filtered = filtered.filter(p =>
      (p.name || '').toLowerCase().includes(search) ||
      (p.description || '').toLowerCase().includes(search) ||
      (p.sku || '').toLowerCase().includes(search));
  }

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'price-asc') return a.price_cents - b.price_cents;
    if (sortBy === 'price-desc') return b.price_cents - a.price_cents;
    if (sortBy === 'purity') return (b.purity || '').localeCompare(a.purity || '');
    return a.name.localeCompare(b.name);
  });

  acionaRenderProductGrid(filtered);
}

function acionaRenderProductGrid(products) {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  if (products.length === 0) {
    grid.innerHTML = '<p style="color:var(--ink-soft);">No products match your search.</p>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const { qty, outOfStock, lowStock } = acionaStockStatus(p);
    return `
    <div class="card clickable" onclick="acionaOpenModal('${p.id}')">
      ${outOfStock ? `<div class="stock-badge">Out of stock</div>` : ''}
      ${lowStock ? `<div class="stock-badge low">Only ${qty} left</div>` : ''}
      <div class="card-image">
        <img class="card-image-bg" src="${p.image_url || PLACEHOLDER_IMAGE_SVG}" alt="" aria-hidden="true" loading="lazy">
        <img class="card-image-fg" src="${p.image_url || PLACEHOLDER_IMAGE_SVG}" alt="${p.name}" loading="lazy">
      </div>
      ${p.show_research_banner !== false ? `<div class="research-banner">⚠ For research use only</div>` : ''}
      <div class="code mono">${p.sku}</div>
      <div class="title-row">
        <h3>${p.name}</h3>
        ${!outOfStock ? `<span class="stock-pill">In stock</span>` : ''}
      </div>
      <div class="desc">${p.description || ''}</div>
      <div class="metrics">
        <div class="purity">${p.purity || '—'}<span>Purity</span></div>
        <div class="purity">${formatPrice(p.price_cents)}<span>Price</span></div>
      </div>
      ${outOfStock
        ? `<div class="notify-row">
             <button class="btn btn-outline" style="flex:1; justify-content:center;" disabled onclick="event.stopPropagation();">Out of stock</button>
             <button class="notify-bell" title="Notify me when available" onclick="event.stopPropagation(); acionaToggleNotify('${p.id}', 'card')">🔔</button>
           </div>
           ${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}
           ${acionaNotifyPopoverHtml(p.id, 'card')}`
        : `<button class="btn btn-primary" style="width:100%; margin-top:14px; justify-content:center;" onclick="event.stopPropagation(); acionaAddToCart('${p.id}')">Add to cart</button>`
      }
      ${p.wiki_url ? `<a href="${p.wiki_url}" onclick="event.stopPropagation();" class="coa-link" style="display:block; text-align:center; margin-top:10px; font-size:.82rem;">Research reference →</a>` : ''}
    </div>
  `;
  }).join('');
}

// Shared markup for the "Notify me when available" inline popover. The card
// grid and the quick-view modal can both show a popover for the same
// product at once, so DOM ids are scoped by `context` ('card' vs 'modal')
// to avoid colliding duplicate ids.
function acionaNotifyPopoverHtml(productId, context) {
  const key = `${context}-${productId}`;
  return `
    <div class="notify-popover" id="notify-popover-${key}" onclick="event.stopPropagation();">
      <label for="notify-email-${key}">Notify me when available</label>
      <div class="row">
        <input type="email" id="notify-email-${key}" placeholder="you@email.com" required>
        <button class="btn btn-primary" onclick="acionaSubmitNotify('${productId}', '${context}')">Notify me</button>
      </div>
      <div class="notify-msg" id="notify-msg-${key}"></div>
    </div>
  `;
}

function acionaToggleNotify(productId, context) {
  const popover = document.getElementById(`notify-popover-${context}-${productId}`);
  if (popover) popover.classList.toggle('open');
}

async function acionaSubmitNotify(productId, context) {
  const key = `${context}-${productId}`;
  const input = document.getElementById(`notify-email-${key}`);
  const msg = document.getElementById(`notify-msg-${key}`);
  const email = input ? input.value.trim() : '';

  if (!email || !input.checkValidity()) {
    msg.textContent = 'Enter a valid email address.';
    msg.className = 'notify-msg err';
    return;
  }

  const { error } = await supabaseClient
    .from('stock_notifications')
    .insert({ product_id: productId, email });

  if (error) {
    msg.textContent = (error.code === '23505')
      ? "You're already on the list for this product."
      : 'Something went wrong — please try again.';
    msg.className = 'notify-msg err';
    return;
  }

  msg.textContent = "You're on the list — we'll email you when it's back.";
  msg.className = 'notify-msg ok';
  input.value = '';
}

function acionaOpenModal(productId) {
  const p = acionaProducts.find(item => item.id === productId);
  if (!p) return;

  const { qty, outOfStock, lowStock } = acionaStockStatus(p);
  const modal = document.getElementById('product-modal');
  const body = document.getElementById('product-modal-body');

  body.innerHTML = `
    <div class="modal-image">
      <img class="modal-image-bg" src="${p.image_url || PLACEHOLDER_IMAGE_SVG}" alt="" aria-hidden="true">
      <img class="modal-image-fg" src="${p.image_url || PLACEHOLDER_IMAGE_SVG}" alt="${p.name}">
    </div>
    <div class="modal-details">
      ${outOfStock ? `<div class="stock-badge" style="position:static; display:inline-block; margin-bottom:10px;">Out of stock</div>` : ''}
      ${lowStock ? `<div class="stock-badge low" style="position:static; display:inline-block; margin-bottom:10px;">Only ${qty} left</div>` : ''}
      <div class="code mono">${p.sku}</div>
      <h2>${p.name}</h2>
      <p style="color:var(--ink-soft);">${p.description || 'No description yet.'}</p>

      <div class="coa-row"><span class="label">Purity (HPLC)</span><span class="value">${p.purity || '—'}</span></div>
      <div class="coa-row"><span class="label">Batch</span><span class="value">${p.batch_code || '—'}</span></div>
      <div class="coa-row"><span class="label">Price</span><span class="value">${formatPrice(p.price_cents)}</span></div>

      ${p.coa_url ? `<a href="${p.coa_url}" target="_blank" rel="noopener" class="coa-link" style="display:inline-block; margin-top:12px;">View Certificate of Analysis →</a>` : ''}
      ${p.wiki_url ? `<a href="${p.wiki_url}" class="coa-link" style="display:inline-block; margin-top:12px; margin-left:16px;">Research reference →</a>` : ''}

      ${outOfStock
        ? `<div class="notify-row" style="margin-top:20px;">
             <button class="btn btn-outline" style="flex:1; justify-content:center;" disabled>Out of stock</button>
             <button class="notify-bell" title="Notify me when available" onclick="acionaToggleNotify('${p.id}', 'modal')">🔔</button>
           </div>
           ${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}
           ${acionaNotifyPopoverHtml(p.id, 'modal')}`
        : `<button class="btn btn-primary" style="width:100%; margin-top:20px; justify-content:center;" onclick="acionaAddToCartFromModal('${p.id}')">Add to cart</button>`
      }
    </div>
  `;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function acionaAddToCartFromModal(productId) {
  acionaAddToCart(productId, 1);
  acionaCloseModal();
}

function acionaCloseModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', acionaLoadProducts);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') acionaCloseModal();
});
