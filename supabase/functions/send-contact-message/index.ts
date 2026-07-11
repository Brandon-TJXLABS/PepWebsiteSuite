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

// Matches styles.css :root variables (the Golden/Natural palette, as of the
// 2026-07-11 rebrand) -- kept in sync by hand with send-order-email/index.ts,
// since email clients can't read the site's actual stylesheet.
const COLOR = {
  bg: "#F7EFDE",
  panel: "#FFFBF2",
  ink: "#2B2013",
  inkSoft: "#6B5C46",
  blueDeep: "#1B3A5C",
  gold: "#A8752F",
  pale: "#F0E3C4",
  line: "#E6D8B8",
};
const LOGO_URL = "https://acionaco.com/images/logo-mark-navy.png";

// Contact-form fields are unescaped user input -- escape before embedding in
// the HTML email.
function escapeHtml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
    <div style="background:${COLOR.bg}; padding:32px 12px; font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" style="max-width:520px; margin:0 auto; background:${COLOR.panel}; border:1px solid ${COLOR.line}; border-radius:8px; overflow:hidden;">
        <tr>
          <td style="padding:20px 26px 16px; border-bottom:1px solid ${COLOR.line};">
            <table role="presentation"><tr>
              <td valign="middle" style="padding-right:8px;"><img src="${LOGO_URL}" width="22" height="22" alt="Aciona" style="display:block; width:22px; height:22px;"></td>
              <td valign="middle"><span style="font-size:15px; font-weight:bold; color:${COLOR.blueDeep}; letter-spacing:.03em;">ACIONA</span></td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 26px 6px;">
            <div style="font-size:11px; font-weight:bold; letter-spacing:.06em; text-transform:uppercase; color:${COLOR.gold};">Owner alert</div>
            <div style="font-size:17px; font-weight:bold; color:${COLOR.blueDeep}; margin-top:6px;">New contact message</div>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 26px 4px;">
            <table role="presentation" width="100%" style="border-collapse:collapse; font-size:13.5px;">
              <tr><td style="padding:6px 0; color:${COLOR.inkSoft};">From</td><td style="padding:6px 0; color:${COLOR.ink}; text-align:right;">${escapeHtml(msg.name)} (${escapeHtml(msg.email)})</td></tr>
              <tr><td style="padding:6px 0; color:${COLOR.inkSoft};">Topic</td><td style="padding:6px 0; color:${COLOR.ink}; text-align:right;">${escapeHtml(msg.topic || "(none selected)")}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 26px 24px;">
            <table role="presentation" width="100%" style="background:${COLOR.pale}; border-radius:4px;">
              <tr><td style="padding:14px 16px; font-size:13.5px; color:${COLOR.ink}; line-height:1.6; white-space:pre-wrap;">${escapeHtml(msg.message)}</td></tr>
            </table>
          </td>
        </tr>
      </table>
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
