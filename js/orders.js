// Shared between checkout.html (post-order confirmation) and account.html
// (revisiting a still-unpaid order later) — not loaded sitewide. Exists so
// the payment-instructions panel (a real chunk of logic: reference
// formatting, copy buttons) isn't duplicated across both files.

function acionaOrderReference(order) {
  return order.order_number ? `AC-${order.order_number}` : order.id.slice(0, 8).toUpperCase();
}

function acionaOrderGrandTotal(order) {
  const hasShipping = order.shipping_cents !== null && order.shipping_cents !== undefined;
  return order.total_cents + (hasShipping ? order.shipping_cents : 0);
}

async function acionaCopyToClipboard(text, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btnEl.textContent;
    btnEl.textContent = 'Copied!';
    setTimeout(() => { btnEl.textContent = original; }, 1500);
  } catch (e) {
    console.error('Copy failed', e);
  }
}

// Escapes a value for safe embedding inside a single-quoted JS string
// literal in an onclick="..." attribute (copy-button values come from
// admin-set payment_settings text fields, not arbitrary user input, but
// this avoids a stray apostrophe/backslash breaking the attribute).
function acionaJsStringEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function acionaCopyRow(label, value) {
  const display = value || '—';
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:4px 0;">
      <span>${label}: ${display}</span>
      <button type="button" class="btn btn-outline" style="padding:2px 10px; font-size:.72rem; flex-shrink:0;" onclick="acionaCopyToClipboard('${acionaJsStringEscape(display)}', this)">Copy</button>
    </div>`;
}

// Full payment-instructions panel for a still-unpaid order — PayID + bank
// transfer, both with the same reference/amount, plus a soft
// (non-automated) expiry warning. Used right after checkout AND later
// from account.html for any order still in pending_payment.
function acionaRenderPaymentInstructions(order, paymentSettings) {
  const ref = acionaOrderReference(order);
  const grandTotal = acionaOrderGrandTotal(order);
  const amount = `$${(grandTotal / 100).toFixed(2)} AUD`;

  return `
    <div class="disclaimer" style="background:#FFF8E1; border-color:#F0D999; margin:16px 0;">
      <strong>Action required.</strong> Your order is placed but not yet paid — stock isn't guaranteed until we receive payment. Please pay within 72 hours; unpaid orders may be cancelled without further notice.
    </div>

    <div class="payment-instructions active">
      <strong>Pay via PayID&reg;</strong>
      <p style="color:var(--ink-soft); margin:8px 0 0;">Open your banking app, choose PayID, and pay to the identifier below using the exact amount and reference.</p>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--blue-mid); font-size:.85rem;">Click to view step-by-step instructions</summary>
        <ol style="color:var(--ink-soft); font-size:.85rem; margin:10px 0 0; padding-left:20px; line-height:1.8;">
          <li>Open your banking app.</li>
          <li>Tap "Pay" or "Pay someone".</li>
          <li>Select PayID as the payment method.</li>
          <li>Enter our PayID shown below.</li>
          <li>Enter the exact amount shown, including cents.</li>
          <li>Enter the reference shown below.</li>
          <li>Submit the payment.</li>
        </ol>
      </details>
      <div class="mono-block" style="margin-top:10px;">
        ${acionaCopyRow('PayID', paymentSettings.payid)}
        ${acionaCopyRow('Reference', ref)}
        ${acionaCopyRow('Amount', amount)}
      </div>
    </div>

    <div class="payment-instructions active" style="margin-top:16px;">
      <strong>Or pay via bank transfer</strong>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--blue-mid); font-size:.85rem;">Click to view step-by-step instructions</summary>
        <ol style="color:var(--ink-soft); font-size:.85rem; margin:10px 0 0; padding-left:20px; line-height:1.8;">
          <li>Open your banking app or online banking.</li>
          <li>Choose "Pay someone" / "New payment" / "Transfer".</li>
          <li>Enter the BSB and account number shown below.</li>
          <li>Enter the exact amount shown, including cents.</li>
          <li>Enter the reference shown below.</li>
          <li>Submit the payment.</li>
        </ol>
      </details>
      <div class="mono-block" style="margin-top:10px;">
        ${acionaCopyRow('Account name', paymentSettings.bank_account_name)}
        ${acionaCopyRow('BSB', paymentSettings.bank_bsb)}
        ${acionaCopyRow('Account number', paymentSettings.bank_account_number)}
        ${acionaCopyRow('Reference', ref)}
        ${acionaCopyRow('Amount', amount)}
      </div>
    </div>

    <p style="font-size:.8rem; color:var(--ink-soft); margin-top:12px;">
      Please pay the exact amount shown (including cents) and use the reference above so we can match your payment automatically — you can also add your name in the payment description for extra clarity.
    </p>
    <p style="font-size:.78rem; color:var(--ink-soft); margin-top:6px;">
      Your bank may hold the first payment to a new payee for up to 24 hours — this is normal and outside our control.
    </p>
  `;
}

async function acionaCancelUnpaidOrder(orderId, onDone) {
  if (!confirm('Cancel this order? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('orders').delete().eq('id', orderId);
  if (error) {
    alert('Could not cancel this order. Please try again or contact support.');
    console.error(error);
    return;
  }
  if (typeof onDone === 'function') onDone();
}
