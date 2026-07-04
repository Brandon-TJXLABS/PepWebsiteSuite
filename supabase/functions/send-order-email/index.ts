// Git-tracked reference copy only. The live version is pasted directly into
// the Supabase Dashboard (Edge Functions → send-order-email) — there is no
// CI/CD link between this file and the deployed function. If you edit this
// file, you must manually re-paste it into the dashboard to deploy the change.
//
// Triggered by a Supabase Database Webhook on `orders` INSERT (see
// docs/DATABASE_SCHEMA.md / sql-editor/migrations for the webhook setup).
// Written generically around order id + status so a future webhook on
// `orders` UPDATE (status -> 'shipped') can reuse this same function for a
// shipping-notification email — only the INSERT/confirmation path is wired
// up for now.

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEARCH_USE_DISCLAIMER =
  "Research use only. Products listed on this site are sold for laboratory " +
  "research purposes only. They are not drugs, dietary supplements, or " +
  "cosmetics, and are not intended for human or animal consumption. Not " +
  "evaluated for safety or efficacy in humans. By purchasing, you confirm " +
  "you are a qualified researcher and will handle these compounds in " +
  "accordance with your local laws and institutional guidelines.";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)} USD`;
}

function buildOrderEmailHtml(order: any, items: any[], emailKind: "confirmation" | "shipped"): string {
  const displayNumber = order.order_number ?? order.id.slice(0, 8);
  const hasShipping = order.shipping_cents !== null && order.shipping_cents !== undefined;
  const grandTotal = order.total_cents + (hasShipping ? order.shipping_cents : 0);

  const heading =
    emailKind === "shipped"
      ? `Your order #${displayNumber} has shipped`
      : `Order confirmation — #${displayNumber}`;

  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 0;">${item.product_name} × ${item.quantity}</td>
          <td style="padding:6px 0; text-align:right;">${money(item.price_cents * item.quantity)}</td>
        </tr>`
    )
    .join("");

  const trackingLine =
    emailKind === "shipped" && order.tracking_number
      ? `<p><strong>Tracking number:</strong> ${order.tracking_number}</p>`
      : "";

  return `
    <div style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto; color:#1a1a1a;">
      <h2>${heading}</h2>
      <table style="width:100%; border-collapse:collapse;">
        ${itemRows}
        <tr><td style="padding:6px 0; border-top:1px solid #ddd;">Subtotal</td><td style="padding:6px 0; text-align:right; border-top:1px solid #ddd;">${money(order.total_cents)}</td></tr>
        <tr><td style="padding:6px 0;">Shipping</td><td style="padding:6px 0; text-align:right;">${hasShipping ? money(order.shipping_cents) : "Awaiting quote"}</td></tr>
        <tr><td style="padding:6px 0; font-weight:bold;">Total</td><td style="padding:6px 0; text-align:right; font-weight:bold;">${money(grandTotal)}${hasShipping ? "" : " + shipping"}</td></tr>
      </table>
      ${trackingLine}
      <p style="margin-top:24px; font-size:12px; color:#666; border-top:1px solid #eee; padding-top:12px;">
        ${RESEARCH_USE_DISCLAIMER}
      </p>
    </div>`;
}

Deno.serve(async (req) => {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const order = payload.record;
  if (!order?.id) return new Response("missing order id", { status: 400 });

  // v1 is wired to INSERT only. Kept generic for a future 'shipped' webhook.
  const emailKind: "confirmation" | "shipped" =
    payload.type === "UPDATE" && order.status === "shipped" ? "shipped" : "confirmation";
  if (payload.type === "UPDATE" && order.status !== "shipped") {
    return new Response("no-op", { status: 200 });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", order.id)
    .single();

  if (orderError || !orderRow) {
    console.error("order lookup failed", orderError);
    return new Response("order not found", { status: 404 });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(orderRow.user_id);
  const customerEmail = userData?.user?.email;
  if (userError || !customerEmail) {
    console.error("no email on file for order", orderRow.id, userError);
    return new Response("no email on file", { status: 200 });
  }

  const html = buildOrderEmailHtml(orderRow, orderRow.order_items, emailKind);
  const subject =
    emailKind === "shipped"
      ? `Your Aciona order #${orderRow.order_number} has shipped`
      : `Order confirmation — Aciona #${orderRow.order_number}`;

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aciona Orders <orders@acionaco.com>",
      to: [customerEmail],
      subject,
      html,
    }),
  });

  if (!resendResp.ok) {
    console.error("Resend send failed", await resendResp.text());
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
