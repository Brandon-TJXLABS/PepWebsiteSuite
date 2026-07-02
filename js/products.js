// Loads products from Supabase and renders them into the #products-grid element on index.html

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
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

  grid.innerHTML = products.map(p => `
    <div class="card">
      ${!p.in_stock ? `<div class="stock-badge">Out of stock</div>` : ''}
      <div class="code mono">${p.sku}</div>
      <h3>${p.name}</h3>
      <div class="desc">${p.description || ''}</div>
      <div class="metrics">
        <div class="purity">${p.purity || '—'}<span>Purity</span></div>
        <div class="purity">${formatPrice(p.price_cents)}<span>Price</span></div>
      </div>
      ${p.in_stock
        ? `<button class="btn btn-primary" style="width:100%; margin-top:14px; justify-content:center;" onclick="purevialAddToCart('${p.id}')">Add to cart</button>`
        : `<button class="btn btn-outline" style="width:100%; margin-top:14px; justify-content:center;" disabled>Out of stock</button>
           ${p.restock_date ? `<div class="restock-note">Back in stock ${formatRestockDate(p.restock_date)}</div>` : ''}`
      }
    </div>
  `).join('');
}

function formatRestockDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

document.addEventListener('DOMContentLoaded', purevialLoadProducts);
