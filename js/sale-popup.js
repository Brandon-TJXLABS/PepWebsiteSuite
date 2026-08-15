// Site-wide configurable sale popup -- pulls its content from the
// single-row sale_popup_settings table (edited from admin.html's Checkout
// Settings tab). Loaded on every customer-facing page except admin.html,
// right after shipping.js in the standard script chain.
//
// - Draggable (Pointer Events, works for mouse/touch/pen alike) -- position
//   persists across page loads via localStorage, since it's purely a UI
//   preference (unlike the age gate, which deliberately uses sessionStorage
//   -- see CLAUDE.md).
// - "Toggleable": closing collapses it to a small reopenable badge rather
//   than hiding it outright, matching the ask that it "stays on screen".
// - Dismissal is keyed to the settings row's updated_at, so changing the
//   sale in admin.html (new discount, new end date, etc.) makes the popup
//   reappear for everyone who'd already dismissed the previous one.

(function () {
  const POS_KEY = 'acionaSalePopupPos';
  const DISMISS_KEY = 'acionaSalePopupDismissed';

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

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

    const dismissedFor = sessionStorage.getItem(DISMISS_KEY);
    const startCollapsed = dismissedFor === String(settings.updated_at);

    const wrap = document.createElement('div');
    wrap.className = 'sale-popup-wrap';
    wrap.innerHTML = `
      <div class="sale-popup-badge" tabindex="0" role="button" aria-label="Show sale offer" style="display:none;">
        <span>${settings.discount_percent ? settings.discount_percent + '%' : '%'}</span>
      </div>
      <div class="sale-popup" role="dialog" aria-label="Special offer">
        <div class="sale-popup-drag" aria-hidden="true">
          <span class="sale-popup-drag-dots">⠿</span> Drag to move
          <button type="button" class="sale-popup-close" aria-label="Minimise offer">×</button>
        </div>
        <div class="sale-popup-body">
          ${settings.discount_percent ? `<div class="sale-popup-pct">${settings.discount_percent}<span>% OFF</span></div>` : ''}
          <div class="sale-popup-headline">${settings.headline || ''}</div>
          ${settings.promo_code ? `
            <div class="sale-popup-code">
              <span>${settings.promo_code}</span>
              <button type="button" class="sale-popup-copy">Copy</button>
            </div>` : ''}
          ${endsAt ? `<div class="sale-popup-countdown"></div>` : ''}
          <a class="btn btn-primary sale-popup-cta" href="${settings.cta_url || 'shop'}">${settings.cta_text || 'Shop now'}</a>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const popupEl = wrap.querySelector('.sale-popup');
    const badgeEl = wrap.querySelector('.sale-popup-badge');
    const dragHandle = wrap.querySelector('.sale-popup-drag');
    const closeBtn = wrap.querySelector('.sale-popup-close');
    const countdownEl = wrap.querySelector('.sale-popup-countdown');
    const copyBtn = wrap.querySelector('.sale-popup-copy');

    // ---------- position (shared between popup + collapsed badge) ----------
    function applyPos(x, y) {
      const w = wrap.offsetWidth || 320, h = wrap.offsetHeight || 200;
      x = clamp(x, 8, window.innerWidth - w - 8);
      y = clamp(y, 8, window.innerHeight - h - 8);
      wrap.style.left = x + 'px';
      wrap.style.top = y + 'px';
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
      wrap.classList.add('sale-popup-dragged');
    }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { /* ignore malformed value */ }
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      requestAnimationFrame(() => applyPos(saved.x, saved.y));
    }

    // ---------- collapse / expand ----------
    function collapse(remember) {
      popupEl.style.display = 'none';
      badgeEl.style.display = 'flex';
      if (remember) sessionStorage.setItem(DISMISS_KEY, String(settings.updated_at));
    }
    function expand() {
      popupEl.style.display = '';
      badgeEl.style.display = 'none';
    }
    if (startCollapsed) collapse(false); else expand();

    closeBtn.addEventListener('click', () => collapse(true));
    badgeEl.addEventListener('click', expand);
    badgeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); } });

    // ---------- countdown ----------
    let timer = null;
    if (endsAt && countdownEl) {
      const tick = () => {
        const label = formatCountdown(endsAt.getTime() - Date.now());
        if (!label) { collapse(false); wrap.style.display = 'none'; clearInterval(timer); return; }
        countdownEl.textContent = 'Ends in ' + label;
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    // ---------- copy promo code ----------
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(settings.promo_code);
          const original = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = original; }, 1500);
        } catch (e) { /* clipboard permission denied -- fail silently */ }
      });
    }

    // ---------- drag (mouse, touch, pen -- unified via Pointer Events) ----------
    let dragging = false, startX = 0, startY = 0, originX = 0, originY = 0;
    dragHandle.addEventListener('pointerdown', (e) => {
      if (e.target === closeBtn) return;
      dragging = true;
      dragHandle.setPointerCapture(e.pointerId);
      const rect = wrap.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      originX = rect.left; originY = rect.top;
      dragHandle.style.cursor = 'grabbing';
    });
    dragHandle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyPos(originX + (e.clientX - startX), originY + (e.clientY - startY));
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      dragHandle.style.cursor = 'grab';
      const rect = wrap.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
    }
    dragHandle.addEventListener('pointerup', endDrag);
    dragHandle.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', () => {
      const rect = wrap.getBoundingClientRect();
      applyPos(rect.left, rect.top);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof supabaseClient !== 'undefined') acionaInitSalePopup();
  });
})();
