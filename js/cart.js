// Cart helpers — cart is stored in Supabase per logged-in user

// Placeholder shown when a product has no image_url set yet. Defined here
// (not products.js) since cart.js loads on every page and always loads
// before products.js where both are present — products.js reuses this
// same constant rather than defining its own copy.
const PLACEHOLDER_IMAGE_SVG = `data:image/svg+xml;utf8,` + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <rect width="300" height="200" fill="#E3EEF5"/>
  <text x="150" y="105" font-family="IBM Plex Mono, monospace" font-size="12" fill="#57697A" text-anchor="middle">No image yet</text>
</svg>
`);

// Matches the quantity <= 10 condition on cart_items' customer-facing RLS
// policies (sql-editor/migrations/2026-07-06_cart_qty_cap.sql) — clamped
// client-side too so the customer sees a friendly message instead of a raw
// database error when they hit it.
const CART_QTY_CAP = 10;
const CART_QTY_CAP_MESSAGE = 'Maximum 10 per item. Please contact us for a custom bulk invoice quote.';

async function acionaAddToCart(productId, quantity = 1) {
  const user = await acionaGetUser();
  if (!user) {
    // Preserve intent so login.html can complete this add automatically
    // once the customer signs in, instead of silently dropping it.
    sessionStorage.setItem('aciona_pending_cart_add', JSON.stringify({ productId, quantity }));
    window.location.href = 'login.html';
    return;
  }

  if (typeof acionaTrack === 'function') {
    acionaTrack('add_to_cart', { productId });
  }

  // Check if this product is already in the cart, bump quantity if so
  const { data: existing } = await supabaseClient
    .from('cart_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('product_id', productId)
    .maybeSingle();

  if (existing) {
    await supabaseClient
      .from('cart_items')
      .update({ quantity: Math.min(existing.quantity + quantity, CART_QTY_CAP) })
      .eq('id', existing.id);
  } else {
    await supabaseClient
      .from('cart_items')
      .insert({ user_id: user.id, product_id: productId, quantity: Math.min(quantity, CART_QTY_CAP) });
  }

  acionaUpdateCartCount();
  acionaOpenCartDrawer();
}

async function acionaGetCart() {
  const user = await acionaGetUser();
  if (!user) return [];

  const { data, error } = await supabaseClient
    .from('cart_items')
    .select('id, quantity, products ( id, name, sku, purity, price_cents, batch_code, stock_quantity, active, image_url )')
    .eq('user_id', user.id);

  if (error) {
    console.error('Error loading cart', error);
    return [];
  }
  return data;
}

async function acionaRemoveFromCart(cartItemId) {
  await supabaseClient.from('cart_items').delete().eq('id', cartItemId);
}

async function acionaUpdateCartQuantity(cartItemId, quantity) {
  if (quantity < 1) {
    await acionaRemoveFromCart(cartItemId);
    return;
  }
  await supabaseClient.from('cart_items').update({ quantity: Math.min(quantity, CART_QTY_CAP) }).eq('id', cartItemId);
}

async function acionaClearCart() {
  const user = await acionaGetUser();
  if (!user) return;
  await supabaseClient.from('cart_items').delete().eq('user_id', user.id);
}

// Updates a small badge in the nav showing item count, if present (id="cart-count")
async function acionaUpdateCartCount() {
  const badge = document.getElementById('cart-count');
  if (!badge) return;
  const cart = await acionaGetCart();
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  badge.textContent = count > 0 ? count : '';
}

document.addEventListener('DOMContentLoaded', acionaUpdateCartCount);

// ---------- Cart drawer (side sheet) ----------
// Shared markup lives on every page (#cart-drawer-overlay). Opens
// automatically after a successful add-to-cart from anywhere on the site;
// the nav cart icon still navigates straight to cart.html, unchanged.

function acionaOpenCartDrawer() {
  const overlay = document.getElementById('cart-drawer-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  acionaRenderCartDrawer();
}

function acionaCloseCartDrawer() {
  const overlay = document.getElementById('cart-drawer-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// Builds the free-shipping progress bar, reusing the real threshold from
// js/shipping.js (FREE_SHIPPING_THRESHOLD_CENTS) rather than a separate
// hardcoded number, and acionaCalculateShipping's requiresQuote flag for
// the 60+ vial edge case.
function acionaShippingProgressHtml(subtotalCents, shipping) {
  if (shipping.requiresQuote) {
    return `<div class="shipping-progress"><p class="shipping-progress-label">Your order is 60+ vials — shipping needs a manual quote at checkout.</p></div>`;
  }

  const remaining = FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents;
  if (remaining <= 0) {
    return `
      <div class="shipping-progress">
        <div class="shipping-progress-track-wrap">
          <div class="shipping-progress-track"><div class="shipping-progress-mask" style="width:0%;"></div></div>
          <span class="shipping-progress-truck" style="left:100%;">🚚</span>
        </div>
        <p class="shipping-progress-label done">Free shipping unlocked!</p>
      </div>`;
  }

  const pct = Math.max(0, Math.min(100, (subtotalCents / FREE_SHIPPING_THRESHOLD_CENTS) * 100));
  return `
    <div class="shipping-progress">
      <div class="shipping-progress-track-wrap">
        <div class="shipping-progress-track"><div class="shipping-progress-mask" style="width:${100 - pct}%;"></div></div>
        <span class="shipping-progress-truck" style="left:${pct}%;">🚚</span>
      </div>
      <p class="shipping-progress-label">Spend $${(remaining / 100).toFixed(2)} more for free shipping</p>
    </div>`;
}

async function acionaRenderCartDrawer() {
  const body = document.getElementById('cart-drawer-body');
  const footer = document.getElementById('cart-drawer-footer');
  if (!body) return;

  const cart = await acionaGetCart();

  if (cart.length === 0) {
    body.innerHTML = `<div class="drawer-empty">Your cart is empty.<br><a href="index.html">Continue shopping</a></div>`;
    if (footer) footer.style.display = 'none';
    return;
  }

  if (footer) footer.style.display = 'block';

  let subtotal = 0;
  let totalVials = 0;

  // Same "unavailable"/"exceeds current stock" checks checkout.html already
  // pre-checks before letting an order through — reused here rather than a
  // second copy of that logic.
  const itemsHtml = cart.map(item => {
    const product = item.products;
    const unavailable = product.active === false;
    const overStock = !unavailable && product.stock_quantity != null && item.quantity > product.stock_quantity;

    if (!unavailable) {
      subtotal += product.price_cents * item.quantity;
      totalVials += item.quantity;
    }

    const atCap = item.quantity >= CART_QTY_CAP;

    return `
      <div class="drawer-item">
        <img class="drawer-item-image" src="${product.image_url || PLACEHOLDER_IMAGE_SVG}" alt="${product.name}" loading="lazy">
        <div class="drawer-item-details">
          <strong>${product.name}</strong>
          <div class="drawer-item-sku">${product.sku}</div>
          <div class="drawer-item-price">$${(product.price_cents / 100).toFixed(2)} ea</div>
          ${unavailable ? `<div class="drawer-warning">No longer available — remove to continue</div>` : ''}
          ${overStock ? `<div class="drawer-warning">Only ${product.stock_quantity} left — reduce quantity</div>` : ''}
          ${!unavailable ? `
            <div class="drawer-item-qty">
              <button onclick="acionaDrawerChangeQty('${item.id}', ${item.quantity - 1})">−</button>
              <span class="mono">${item.quantity}</span>
              <button onclick="acionaDrawerChangeQty('${item.id}', ${item.quantity + 1})" ${atCap ? 'disabled' : ''}>+</button>
            </div>
            ${atCap ? `<div class="drawer-cap-note">${CART_QTY_CAP_MESSAGE}</div>` : ''}
          ` : ''}
        </div>
        <a href="#" class="drawer-remove" onclick="acionaDrawerRemoveItem('${item.id}'); return false;">Remove</a>
      </div>
    `;
  }).join('');

  const shipping = acionaCalculateShipping(totalVials, subtotal);

  body.innerHTML = `
    <div class="bac-water-note"><strong>Please note:</strong> BAC Water is not included with your peptides — sold separately.</div>
    ${acionaShippingProgressHtml(subtotal, shipping)}
    ${itemsHtml}
  `;

  if (footer) {
    footer.innerHTML = `
      <div class="coa-row" style="border:none; padding:0 0 12px;"><span class="label">Subtotal</span><span class="value">$${(subtotal / 100).toFixed(2)} USD</span></div>
      <div class="drawer-actions">
        <a href="cart.html" class="btn btn-outline">View cart</a>
        <a href="checkout.html" class="btn btn-primary">Checkout</a>
      </div>
    `;
  }
}

async function acionaDrawerChangeQty(cartItemId, newQty) {
  await acionaUpdateCartQuantity(cartItemId, newQty);
  await acionaRenderCartDrawer();
  acionaUpdateCartCount();
}

async function acionaDrawerRemoveItem(cartItemId) {
  await acionaRemoveFromCart(cartItemId);
  await acionaRenderCartDrawer();
  acionaUpdateCartCount();
}
