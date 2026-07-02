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
      <div class="code mono">${p.sku}</div>
      <h3>${p.name}</h3>
      <div class="desc">${p.description || ''}</div>
      <div class="metrics">
        <div class="purity">${p.purity || '—'}<span>Purity</span></div>
        <div class="purity">${formatPrice(p.price_cents)}<span>Price</span></div>
      </div>
      <button class="btn btn-primary" style="width:100%; margin-top:14px; justify-content:center;" onclick="purevialAddToCart('${p.id}')">Add to cart</button>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', purevialLoadProducts);
