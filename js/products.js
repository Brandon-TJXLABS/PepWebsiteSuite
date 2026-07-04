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

// Placeholder shown when a product has no image_url set yet
const PLACEHOLDER_IMAGE_SVG = `data:image/svg+xml;utf8,` + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <rect width="300" height="200" fill="#E3EEF5"/>
  <text x="150" y="105" font-family="IBM Plex Mono, monospace" font-size="12" fill="#57697A" text-anchor="middle">No image yet</text>
</svg>
`);

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
      <h3>${p.name}</h3>
      <div class="desc">${p.description || ''}</div>
      <div class="metrics">
        <div class="purity">${p.purity || '—'}<span>Purity</span></div>
        <div class="purity">${formatPrice(p.price_cents)}<span>Price</span></div>
      </div>
      ${outOfStock
        ? `<button class="btn btn-outline" style="width:100%; margin-top:14px; justify-content:center;" disabled onclick="event.stopPropagation();">Out of stock</button>
           ${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}`
        : `<button class="btn btn-primary" style="width:100%; margin-top:14px; justify-content:center;" onclick="event.stopPropagation(); acionaAddToCart('${p.id}')">Add to cart</button>`
      }
      ${p.wiki_url ? `<a href="${p.wiki_url}" onclick="event.stopPropagation();" class="coa-link" style="display:block; text-align:center; margin-top:10px; font-size:.82rem;">Research reference →</a>` : ''}
    </div>
  `;
  }).join('');
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
        ? `<button class="btn btn-outline" style="width:100%; margin-top:20px; justify-content:center;" disabled>Out of stock</button>
           ${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}`
        : `<div class="field" style="max-width:120px; margin-top:20px;">
             <label for="modal-qty">Quantity</label>
             <input type="number" id="modal-qty" min="1" value="1">
           </div>
           <button class="btn btn-primary" style="width:100%; margin-top:12px; justify-content:center;" onclick="acionaAddToCartFromModal('${p.id}')">Add to cart</button>`
      }
    </div>
  `;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function acionaAddToCartFromModal(productId) {
  const qtyInput = document.getElementById('modal-qty');
  const quantity = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
  acionaAddToCart(productId, quantity);
}

function acionaCloseModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', acionaLoadProducts);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') acionaCloseModal();
});
