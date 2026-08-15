// Site-wide configurable sale popup -- pulls its content from the
// single-row sale_popup_settings table (edited from admin.html's Checkout
// Settings tab). Loaded on every customer-facing page except admin.html,
// right after shipping.js in the standard script chain.
//
// Static and non-dismissable by design (per owner request, matching a
// reference competitor site): fixed in the bottom-right corner on both
// mobile and desktop, no drag, no close button. The whole card is one link
// to the shop page -- clicking anywhere on it (other than the promo-code
// copy button) navigates there.

(function () {
  function formatCountdown(ms) {
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s` : `${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
  }

  async function acionaInitSalePopup() {
    if (document.body.dataset.acionaNoSalePopup !== undefined) return;

    const { data: settings, error } = await supabaseClient
      .from('sale_popup_settings')
      .select('*')
      .maybeSingle();
    if (error || !settings || !settings.enabled) return;

    const endsAt = settings.ends_at ? new Date(settings.ends_at) : null;
    if (endsAt && endsAt.getTime() <= Date.now()) return;

    // A real <button>/<a> can't validly nest inside an <a> (the promo-code
    // copy button needs its own click target), so this is a <div> acting as
    // a link: role="link", tabindex, and both click/keyboard activation.
    const href = settings.cta_url || 'shop';
    const wrap = document.createElement('div');
    wrap.className = 'sale-popup-wrap';
    wrap.setAttribute('role', 'link');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', (settings.headline || 'Special offer') + ' — click to shop');
    wrap.innerHTML = `
      <div class="sale-popup">
        <div class="sale-popup-body">
          ${settings.discount_percent ? `<div class="sale-popup-pct">${settings.discount_percent}<span>% OFF</span></div>` : ''}
          <div class="sale-popup-headline">${settings.headline || ''}</div>
          ${settings.promo_code ? `
            <div class="sale-popup-code">
              <span>${settings.promo_code}</span>
              <button type="button" class="sale-popup-copy">Copy</button>
            </div>` : ''}
          ${endsAt ? `<div class="sale-popup-countdown"></div>` : ''}
          <span class="btn btn-primary sale-popup-cta">${settings.cta_text || 'Shop now'}</span>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const countdownEl = wrap.querySelector('.sale-popup-countdown');
    const copyBtn = wrap.querySelector('.sale-popup-copy');

    // ---------- click/keyboard navigation to the shop ----------
    wrap.addEventListener('click', () => { window.location.href = href; });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = href; }
    });

    // ---------- countdown ----------
    if (endsAt && countdownEl) {
      const tick = () => {
        const label = formatCountdown(endsAt.getTime() - Date.now());
        if (!label) { wrap.remove(); clearInterval(timer); return; }
        countdownEl.textContent = 'Ends in ' + label;
      };
      tick();
      var timer = setInterval(tick, 1000);
    }

    // ---------- copy promo code (must not trigger the shop-page navigation) ----------
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(settings.promo_code);
          const original = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = original; }, 1500);
        } catch (err) { /* clipboard permission denied -- fail silently */ }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof supabaseClient !== 'undefined') acionaInitSalePopup();
  });
})();
