// Cart helpers — cart is stored in Supabase per logged-in user

async function purevialAddToCart(productId, quantity = 1) {
  const user = await purevialGetUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
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

  purevialUpdateCartCount();
}

async function purevialGetCart() {
  const user = await purevialGetUser();
  if (!user) return [];

  const { data, error } = await supabaseClient
    .from('cart_items')
    .select('id, quantity, products ( id, name, sku, purity, price_cents, batch_code )')
    .eq('user_id', user.id);

  if (error) {
    console.error('Error loading cart', error);
    return [];
  }
  return data;
}

async function purevialRemoveFromCart(cartItemId) {
  await supabaseClient.from('cart_items').delete().eq('id', cartItemId);
}

async function purevialUpdateCartQuantity(cartItemId, quantity) {
  if (quantity < 1) {
    await purevialRemoveFromCart(cartItemId);
    return;
  }
  await supabaseClient.from('cart_items').update({ quantity }).eq('id', cartItemId);
}

async function purevialClearCart() {
  const user = await purevialGetUser();
  if (!user) return;
  await supabaseClient.from('cart_items').delete().eq('user_id', user.id);
}

// Updates a small badge in the nav showing item count, if present (id="cart-count")
async function purevialUpdateCartCount() {
  const badge = document.getElementById('cart-count');
  if (!badge) return;
  const cart = await purevialGetCart();
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  badge.textContent = count > 0 ? count : '';
}

document.addEventListener('DOMContentLoaded', purevialUpdateCartCount);
