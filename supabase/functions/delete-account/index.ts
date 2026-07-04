// Git-tracked reference copy only. The live version is pasted directly into
// the Supabase Dashboard (Edge Functions → delete-account) — there is no
// CI/CD link between this file and the deployed function.
//
// Self-service account deletion, called directly from account.html. Only
// allowed when the account has zero orders -- orders.user_id is ON DELETE
// CASCADE, so a naive delete would permanently destroy order/financial
// history along with the account. Accounts with orders are told to contact
// support instead.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");

  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(bearerToken);
  if (callerError || !callerData?.user) {
    return resp({ error: "unauthorized" }, 401);
  }
  const userId = callerData.user.id;

  const { count, error: countError } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    console.error("order count check failed", countError);
    return resp({ error: "Could not check order history. Please try again." }, 500);
  }

  if (count && count > 0) {
    return resp(
      {
        error:
          "This account has existing orders, which we need to keep for accounting purposes. Please contact support to close your account instead.",
      },
      409
    );
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("account deletion failed", deleteError);
    return resp({ error: "Could not delete account. Please try again or contact support." }, 500);
  }

  return resp({ success: true }, 200);
});
