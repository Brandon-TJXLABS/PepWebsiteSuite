// Git-tracked reference copy only. The live version is pasted directly into
// the Supabase Dashboard (Edge Functions → send-contact-message) — there is
// no CI/CD link between this file and the deployed function.
//
// Triggered by a Supabase Database Webhook on contact_messages INSERT.
// Server-to-server only (no browser calls this directly), so it reuses the
// same WEBHOOK_SECRET shared-secret pattern as send-order-email rather than
// needing CORS handling.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const OWNER_EMAIL = "brandon.matecko@gmail.com";

Deno.serve(async (req) => {
  const webhookSecretHeader = req.headers.get("x-webhook-secret") ?? "";
  if (webhookSecretHeader !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const msg = payload.record;
  if (!msg?.id) return new Response("missing message id", { status: 400 });

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:520px;">
      <h2>New contact message — Aciona</h2>
      <p><strong>From:</strong> ${msg.name} (${msg.email})</p>
      <p><strong>Topic:</strong> ${msg.topic || "(none selected)"}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap; border-left:3px solid #123C6B; padding-left:12px;">${msg.message}</p>
    </div>`;

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aciona Contact Form <orders@acionaco.com>",
      to: [OWNER_EMAIL],
      reply_to: msg.email,
      subject: `New contact message: ${msg.topic || "General"}`,
      html,
    }),
  });

  if (!resendResp.ok) {
    console.error("Resend send failed", await resendResp.text());
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
