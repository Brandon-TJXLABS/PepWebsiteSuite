// Git-tracked reference copy only. The live version is pasted directly into
// the Supabase Dashboard (Edge Functions → send-order-email) — there is no
// CI/CD link between this file and the deployed function. If you edit this
// file, you must manually re-paste it into the dashboard to deploy the change.
//
// Two ways this function is called, each with its own authorization:
// 1. Supabase Database Webhook on `orders` INSERT/UPDATE/DELETE — trusted
//    only if the request carries the shared x-webhook-secret header (see
//    WEBHOOK_SECRET below). INSERT sends the customer a confirmation,
//    UPDATE sends a shipped or cancelled email on the real transition into
//    that status, DELETE (a customer's own self-service cancellation via
//    account.html's hard-delete path -- see docs/DATABASE_SCHEMA.md) alerts
//    the owner instead, since there's no order row left afterward to email
//    the customer a receipt from.
// 2. Manual "resend" from admin.html ({action:'resend', order_id, kind}) —
//    trusted only if the caller's own access token resolves to a
//    profiles.is_admin = true account. This exists so the resend button
//    can't be used by an arbitrary logged-in customer to spam another
//    customer's inbox with their own order details.

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shared secret set on both this function's secrets AND as a custom header
// on the Database Webhook — comparing against SUPABASE_SERVICE_ROLE_KEY
// directly turned out not to match whatever token Supabase's webhook
// actually sends, so this is a simpler, fully-controlled alternative.
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
// Same owner inbox send-contact-message alerts to -- reused here for the
// "customer cancelled their own order" alert (see sendCancellationAlertToOwner).
const OWNER_EMAIL = "brandon.matecko@gmail.com";

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
  return `$${(cents / 100).toFixed(2)} AUD`;
}

// cancellation_reason is admin-entered free text -- escape before embedding
// in the HTML email even though only admins (RLS-gated) can set it.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type OrderEmailKind = "confirmation" | "shipped" | "cancelled";

function buildOrderEmailHtml(order: any, items: any[], emailKind: OrderEmailKind): string {
  const displayNumber = order.order_number ?? order.id.slice(0, 8);
  const hasShipping = order.shipping_cents !== null && order.shipping_cents !== undefined;
  const grandTotal = order.total_cents + (hasShipping ? order.shipping_cents : 0);

  const eyebrow = emailKind === "shipped" ? "Shipping update" : emailKind === "cancelled" ? "Order cancelled" : "Order confirmation";
  const heading =
    emailKind === "shipped"
      ? `Your order #${displayNumber} has shipped`
      : emailKind === "cancelled"
      ? `Your order #${displayNumber} has been cancelled`
      : `Thanks for your order, #${displayNumber}`;

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

  const reasonBlock =
    emailKind === "cancelled" && order.cancellation_reason
      ? `
      <tr>
        <td colspan="3" style="padding:14px 0 0;">
          <table role="presentation" width="100%" style="background:${COLOR.bluePale}; border-radius:4px;">
            <tr><td style="padding:12px 16px; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:${COLOR.blueDeep};">
              <strong>Reason:</strong> ${escapeHtml(order.cancellation_reason)}
            </td></tr>
          </table>
        </td>
      </tr>`
      : "";

  const statusNote =
    emailKind !== "cancelled" && !hasShipping
      ? `<div style="color:${COLOR.amber}; font-size:12.5px; font-weight:bold; margin-top:4px;">Shipping cost pending manual quote</div>`
      : "";

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
            ${reasonBlock}
          </table>
          ${statusNote}
        </td>
      </tr>

      <tr>
        <td style="padding:26px 28px;">
          <a href="https://acionaco.com/account.html" style="display:inline-block; background:${COLOR.blueDeep}; color:#ffffff; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; text-decoration:none; padding:12px 22px; border-radius:3px;">${emailKind === "cancelled" ? "View order history" : "View your order"}</a>
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

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// admin.html calls this function directly from the browser (the manual resend
// path), which means the browser sends a CORS preflight OPTIONS request first
// with an Authorization/Content-Type header — without these headers on every
// response (including the OPTIONS one), the browser blocks the real request
// before it's ever sent. The Database Webhook path doesn't need this (it's a
// server-to-server call, not subject to CORS), but it's harmless to include.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(body: string, status: number): Response {
  return new Response(body, { status, headers: CORS_HEADERS });
}

async function sendOrderEmail(orderId: string, emailKind: OrderEmailKind): Promise<Response> {
  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*, products(image_url))")
    .eq("id", orderId)
    .single();

  if (orderError || !orderRow) {
    console.error("order lookup failed", orderError);
    return resp("order not found", 404);
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(orderRow.user_id);
  const customerEmail = userData?.user?.email;
  if (userError || !customerEmail) {
    console.error("no email on file for order", orderRow.id, userError);
    return resp("no email on file", 200);
  }

  const html = buildOrderEmailHtml(orderRow, orderRow.order_items, emailKind);
  const subject =
    emailKind === "shipped"
      ? `Your Aciona order #${orderRow.order_number} has shipped`
      : emailKind === "cancelled"
      ? `Your Aciona order #${orderRow.order_number} has been cancelled`
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
    return resp("email send failed", 502);
  }

  return resp("ok", 200);
}

// Fires on `orders` DELETE -- account.html's self-service "Cancel order"
// button does a hard delete rather than a status update (customers have no
// UPDATE policy on orders at all, only their own delete-when-unpaid policy
// -- see docs/DATABASE_SCHEMA.md), so by the time this runs the order row
// (and its order_items, cascade-deleted) is already gone. There's no order
// left to email the customer a receipt from, so this alerts the owner
// instead, using whatever the webhook's old_record snapshot still has.
async function sendCancellationAlertToOwner(oldOrder: any): Promise<Response> {
  if (!oldOrder?.id) return resp("missing order id", 400);

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", oldOrder.user_id)
    .maybeSingle();

  const displayNumber = oldOrder.order_number ?? oldOrder.id.slice(0, 8);
  const customerLine = profile
    ? `${profile.full_name || "(no name on file)"} (${profile.email || "no email on file"})`
    : "(customer profile not found)";

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:520px;">
      <h2>Customer cancelled an order — Aciona</h2>
      <p><strong>Order:</strong> #${displayNumber}</p>
      <p><strong>Customer:</strong> ${escapeHtml(customerLine)}</p>
      <p><strong>Order total:</strong> ${money(oldOrder.total_cents ?? 0)}</p>
      <p><strong>Placed:</strong> ${oldOrder.created_at ? new Date(oldOrder.created_at).toLocaleString("en-AU") : "unknown"}</p>
      <p style="color:#57697A; font-size:12.5px;">This order was still unpaid and the customer cancelled it themselves via their account — no reason is captured for self-service cancellations.</p>
    </div>`;

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aciona Orders <orders@acionaco.com>",
      to: [OWNER_EMAIL],
      subject: `Customer cancelled order #${displayNumber}`,
      html,
    }),
  });

  if (!resendResp.ok) {
    console.error("Resend send failed", await resendResp.text());
    return resp("email send failed", 502);
  }

  return resp("ok", 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return resp("invalid json", 400);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");

  // Manual resend path: caller must be a logged-in admin, verified server-side.
  if (payload.action === "resend") {
    const { order_id, kind } = payload;
    if (!order_id || (kind !== "confirmation" && kind !== "shipped" && kind !== "cancelled")) {
      return resp("invalid resend request", 400);
    }

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(bearerToken);
    if (callerError || !callerData?.user) {
      return resp("unauthorized", 401);
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", callerData.user.id)
      .maybeSingle();

    if (!callerProfile?.is_admin) {
      return resp("forbidden", 403);
    }

    return sendOrderEmail(order_id, kind);
  }

  // Database Webhook path: only trusted if it presents the shared secret set
  // as a custom header on the webhook config (see WEBHOOK_SECRET above).
  const webhookSecretHeader = req.headers.get("x-webhook-secret") ?? "";
  if (webhookSecretHeader !== WEBHOOK_SECRET) {
    return resp("forbidden", 403);
  }

  // DELETE: customer self-service cancellation (account.html's "Cancel
  // order" button) -- the row is already gone, `record` is null and
  // `old_record` still has the last-known values. Alerts the owner rather
  // than the customer (see sendCancellationAlertToOwner for why).
  if (payload.type === "DELETE") {
    return sendCancellationAlertToOwner(payload.old_record);
  }

  const order = payload.record;
  if (!order?.id) return resp("missing order id", 400);

  // INSERT always sends a confirmation. UPDATE only sends a shipped/cancelled
  // email on the actual transition into that status (old_record.status was
  // something else) — otherwise editing an already-shipped order later
  // (e.g. fixing a typo in the tracking number) would resend the shipped
  // email every time, same idea for re-saving an already-cancelled order.
  const becameShipped =
    payload.type === "UPDATE" && order.status === "shipped" && payload.old_record?.status !== "shipped";
  const becameCancelled =
    payload.type === "UPDATE" && order.status === "cancelled" && payload.old_record?.status !== "cancelled";

  if (payload.type === "UPDATE" && !becameShipped && !becameCancelled) {
    return resp("no-op", 200);
  }

  const kind: OrderEmailKind = becameShipped ? "shipped" : becameCancelled ? "cancelled" : "confirmation";
  return sendOrderEmail(order.id, kind);
});
