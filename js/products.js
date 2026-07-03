// Loads products from Supabase and renders them into #products-grid on index.html
// Clicking a card opens a quick-view modal with more detail.

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
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

let purevialProducts = [];

// Works out stock status whether or not the stock_quantity migration has
// been run yet, so this never breaks against an older database.
function purevialStockStatus(p) {
  const qty = (p.stock_quantity !== undefined && p.stock_quantity !== null)
    ? p.stock_quantity
    : (p.in_stock === false ? 0 : null); // null = unknown/unlimited, treat as in stock

  const outOfStock = qty !== null && qty <= 0;
  const lowStock = !outOfStock && qty !== null && qty <= LOW_STOCK_THRESHOLD;
  return { qty, outOfStock, lowStock };
}

async function purevialLoadProducts() {
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

  purevialProducts = products;

  grid.innerHTML = products.map(p => {
    const { qty, outOfStock, lowStock } = purevialStockStatus(p);
    return `
    <div class="card clickable" onclick="purevialOpenModal('${p.id}')">
      ${outOfStock ? `<div class="stock-badge">Out of stock</div>` : ''}
      ${lowStock ? `<div class="stock-badge low">Only ${qty} left</div>` : ''}
      <div class="card-image">
        <img src="${p.image_url || PLACEHOLDER_IMAGE_SVG}" alt="${p.name}" loading="lazy">
      </div>
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
        : `<button class="btn btn-primary" style="width:100%; margin-top:14px; justify-content:center;" onclick="event.stopPropagation(); purevialAddToCart('${p.id}')">Add to cart</button>`
      }
    </div>
  `;
  }).join('');
}

function purevialOpenModal(productId) {
  const p = purevialProducts.find(item => item.id === productId);
  if (!p) return;

  const { qty, outOfStock, lowStock } = purevialStockStatus(p);
  const modal = document.getElementById('product-modal');
  const body = document.getElementById('product-modal-body');

  body.innerHTML = `
    <div class="modal-image">
      <img src="${p.image_url || PLACEHOLDER_IMAGE_SVG}" alt="${p.name}">
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

      ${outOfStock
        ? `<button class="btn btn-outline" style="width:100%; margin-top:20px; justify-content:center;" disabled>Out of stock</button>
           ${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}`
        : `<button class="btn btn-primary" style="width:100%; margin-top:20px; justify-content:center;" onclick="purevialAddToCart('${p.id}')">Add to cart</button>`
      }
    </div>
  `;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function purevialCloseModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', purevialLoadProducts);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') purevialCloseModal();
});
