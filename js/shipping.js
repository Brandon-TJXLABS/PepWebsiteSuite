// Shared shipping calculator — used by cart.html (estimate) and
// checkout.html (final cost added to the order total).
//
// Tiers are based on total vial count across the whole cart, with a
// blanket free-shipping override once the subtotal is high enough.

const FREE_SHIPPING_THRESHOLD_CENTS = 35000; // $350.00 AUD

function acionaCalculateShipping(totalVials, subtotalCents) {
  if (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) {
    return { cents: 0, requiresQuote: false, label: 'Free shipping' };
  }
  if (totalVials <= 0) {
    return { cents: 0, requiresQuote: false, label: '$0.00' };
  }
  if (totalVials <= 3) {
    return { cents: 1500, requiresQuote: false, label: '$15.00 AUD' };
  }
  if (totalVials <= 9) {
    return { cents: 2500, requiresQuote: false, label: '$25.00 AUD' };
  }
  if (totalVials <= 29) {
    return { cents: 3500, requiresQuote: false, label: '$35.00 AUD' };
  }
  if (totalVials <= 59) {
    return { cents: 4500, requiresQuote: false, label: '$45.00 AUD' };
  }
  return { cents: null, requiresQuote: true, label: 'Quote required (60+ vials)' };
}
