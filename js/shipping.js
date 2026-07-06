// Shared shipping calculator — used by cart.html (estimate), the cart
// drawer (js/cart.js), and checkout.html (final cost added to the order
// total).
//
// Tiers are based on total vial count across the whole cart, with a
// blanket free-shipping override once the subtotal is high enough.
// Rates are DB-backed (shipping_settings, editable from the admin
// dashboard's Checkout Settings tab) — the constants below are only used
// as a fallback if that fetch ever fails, so shipping never breaks.

const FALLBACK_SHIPPING_SETTINGS = {
  free_shipping_threshold_cents: 35000, // $350.00
  tier1_max_vials: 3,  tier1_cost_cents: 1500,  // $15.00
  tier2_max_vials: 9,  tier2_cost_cents: 2500,  // $25.00
  tier3_max_vials: 29, tier3_cost_cents: 3500,  // $35.00
  tier4_max_vials: 59, tier4_cost_cents: 4500,  // $45.00
};

let acionaShippingSettingsCache = null;

async function acionaGetShippingSettings() {
  if (acionaShippingSettingsCache) return acionaShippingSettingsCache;

  try {
    const { data, error } = await supabaseClient
      .from('shipping_settings')
      .select('*')
      .maybeSingle();
    if (error || !data) throw error || new Error('No shipping_settings row found');
    acionaShippingSettingsCache = data;
  } catch (err) {
    console.error('Could not load shipping settings, using fallback values', err);
    acionaShippingSettingsCache = FALLBACK_SHIPPING_SETTINGS;
  }
  return acionaShippingSettingsCache;
}

async function acionaCalculateShipping(totalVials, subtotalCents) {
  const s = await acionaGetShippingSettings();

  if (subtotalCents >= s.free_shipping_threshold_cents) {
    return { cents: 0, requiresQuote: false, label: 'Free shipping' };
  }
  if (totalVials <= 0) {
    return { cents: 0, requiresQuote: false, label: '$0.00' };
  }
  if (totalVials <= s.tier1_max_vials) {
    return { cents: s.tier1_cost_cents, requiresQuote: false, label: `$${(s.tier1_cost_cents / 100).toFixed(2)} AUD` };
  }
  if (totalVials <= s.tier2_max_vials) {
    return { cents: s.tier2_cost_cents, requiresQuote: false, label: `$${(s.tier2_cost_cents / 100).toFixed(2)} AUD` };
  }
  if (totalVials <= s.tier3_max_vials) {
    return { cents: s.tier3_cost_cents, requiresQuote: false, label: `$${(s.tier3_cost_cents / 100).toFixed(2)} AUD` };
  }
  if (totalVials <= s.tier4_max_vials) {
    return { cents: s.tier4_cost_cents, requiresQuote: false, label: `$${(s.tier4_cost_cents / 100).toFixed(2)} AUD` };
  }
  return { cents: null, requiresQuote: true, label: `Quote required (${s.tier4_max_vials + 1}+ vials)` };
}
