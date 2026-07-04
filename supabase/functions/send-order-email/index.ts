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

// Matches styles.css :root variables, since email clients can't read the stylesheet.
const COLOR = {
  blueDeep: "#123C6B",
  blueMid: "#2F6FA3",
  bluePale: "#E3EEF5",
  ink: "#16212B",
  inkSoft: "#57697A",
  line: "#D7E2E9",
  verified: "#2E8B57",
  amber: "#B8860B",
};

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

  const eyebrow = emailKind === "shipped" ? "Shipping update" : "Order confirmation";
  const heading =
    emailKind === "shipped" ? `Your order #${displayNumber} has shipped` : `Thanks for your order, #${displayNumber}`;

  const itemRows = items
    .map((item) => {
      const imageUrl = item.products?.image_url;
      const imageCell = imageUrl
        ? `<img src="${imageUrl}" width="56" height="56" alt="" style="display:block; width:56px; height:56px; object-fit:cover; border-radius:4px; border:1px solid ${COLOR.line};">`
        : `<div style="width:56px; height:56px; border-radius:4px; background:${COLOR.bluePale}; border:1px solid ${COLOR.line};"></div>`;

      return `
        <tr>
          <td style="padding:10px 0; border-bottom:1px solid ${COLOR.line};" width="56">${imageCell}</td>
          <td style="padding:10px 0 10px 14px; border-bottom:1px solid ${COLOR.line}; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${COLOR.ink};">
            ${item.product_name}<br>
            <span style="color:${COLOR.inkSoft}; font-size:12.5px;">Qty ${item.quantity}</span>
          </td>
          <td style="padding:10px 0; border-bottom:1px solid ${COLOR.line}; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${COLOR.ink}; text-align:right; white-space:nowrap;" valign="top">
            ${money(item.price_cents * item.quantity)}
          </td>
        </tr>`;
    })
    .join("");

  const trackingBlock =
    emailKind === "shipped" && order.tracking_number
      ? `
      <tr>
        <td colspan="3" style="padding:14px 0 0;">
          <table role="presentation" width="100%" style="background:${COLOR.bluePale}; border-radius:4px;">
            <tr><td style="padding:12px 16px; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:${COLOR.blueDeep};">
              <strong>Tracking number:</strong> ${order.tracking_number}
            </td></tr>
          </table>
        </td>
      </tr>`
      : "";

  const statusNote = hasShipping
    ? ""
    : `<div style="color:${COLOR.amber}; font-size:12.5px; font-weight:bold; margin-top:4px;">Shipping cost pending manual quote</div>`;

  return `
  <div style="background:#F8FAFB; padding:32px 12px; font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#FFFFFF; border:1px solid ${COLOR.line}; border-radius:6px; overflow:hidden;">

      <tr>
        <td style="background:${COLOR.blueDeep}; padding:22px 28px;">
          <span style="font-family:Arial,Helvetica,sans-serif; font-size:20px; font-weight:bold; color:#ffffff; letter-spacing:.02em;">ACIONA</span>
        </td>
      </tr>

      <tr>
        <td style="padding:30px 28px 8px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:11.5px; font-weight:bold; letter-spacing:.08em; text-transform:uppercase; color:${COLOR.blueMid};">${eyebrow}</div>
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:21px; font-weight:bold; color:${COLOR.blueDeep}; margin-top:6px;">${heading}</div>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 28px 4px;">
          <table role="presentation" width="100%" style="border-collapse:collapse;">
            ${itemRows}
            <tr>
              <td colspan="2" style="padding:12px 0 4px; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:${COLOR.inkSoft};">Subtotal</td>
              <td style="padding:12px 0 4px; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:${COLOR.ink}; text-align:right;">${money(order.total_cents)}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding:4px 0; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:${COLOR.inkSoft};">Shipping</td>
              <td style="padding:4px 0; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:${COLOR.ink}; text-align:right;">${hasShipping ? money(order.shipping_cents) : "Awaiting quote"}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding:10px 0 0; border-top:1px solid ${COLOR.line}; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:${COLOR.blueDeep};">Total</td>
              <td style="padding:10px 0 0; border-top:1px solid ${COLOR.line}; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:${COLOR.blueDeep}; text-align:right;">${money(grandTotal)}${hasShipping ? "" : " +ship."}</td>
            </tr>
            ${trackingBlock}
          </table>
          ${statusNote}
        </td>
      </tr>

      <tr>
        <td style="padding:26px 28px;">
          <a href="https://acionaco.com/account.html" style="display:inline-block; background:${COLOR.blueDeep}; color:#ffffff; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; text-decoration:none; padding:12px 22px; border-radius:3px;">View your order</a>
        </td>
      </tr>

      <tr>
        <td style="padding:20px 28px 28px; border-top:1px solid ${COLOR.line};">
          <p style="font-family:Arial,Helvetica,sans-serif; font-size:11.5px; line-height:1.6; color:${COLOR.inkSoft}; margin:0 0 12px;">
            ${RESEARCH_USE_DISCLAIMER}
          </p>
          <p style="font-family:Arial,Helvetica,sans-serif; font-size:11.5px; color:${COLOR.inkSoft}; margin:0;">
            Aciona · <a href="https://acionaco.com" style="color:${COLOR.blueMid};">acionaco.com</a>
          </p>
        </td>
      </tr>

    </table>
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
    .select("*, order_items(*, products(image_url))")
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
