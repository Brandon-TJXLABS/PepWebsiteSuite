// Lightweight analytics — fires events into the analytics_events table.
// Never blocks the page and never throws if it fails, so a network hiccup
// here can't break checkout or anything else.

async function acionaTrack(eventType, extra = {}) {
  try {
    const user = await acionaGetUser();
    await supabaseClient.from('analytics_events').insert({
      event_type: eventType,
      product_id: extra.productId || null,
      user_id: user ? user.id : null,
      metadata: extra.metadata || null
    });
  } catch (err) {
    console.warn('Analytics event failed', err);
  }
}

// Logs a page view automatically on every page that includes this script
document.addEventListener('DOMContentLoaded', () => {
  acionaTrack('page_view', { metadata: { path: window.location.pathname } });
});
