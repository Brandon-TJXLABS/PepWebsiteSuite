// Cart helpers — cart is stored in Supabase per logged-in user

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
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id);
  } else {
    await supabaseClient
      .from('cart_items')
      .insert({ user_id: user.id, product_id: productId, quantity });
  }

  acionaUpdateCartCount();
}

async function acionaGetCart() {
  const user = await acionaGetUser();
  if (!user) return [];

  const { data, error } = await supabaseClient
    .from('cart_items')
    .select('id, quantity, products ( id, name, sku, purity, price_cents, batch_code, stock_quantity, active )')
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
  await supabaseClient.from('cart_items').update({ quantity }).eq('id', cartItemId);
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
