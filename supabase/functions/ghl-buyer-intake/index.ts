// GHL "buyer" tag -> CRM review queue. Deliberately does NOT create a client: it drops the
// contact into buyer_intakes as pending, and Alex approves it in the app (which is what
// creates the clients row). Mirrors ghl-verify's shape and token gate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// APOPDUDE/CRECRM is a PUBLIC repo, so the shared secret is read from the environment and
// never written here. Set GHL_VERIFY_TOKEN in the Supabase project's edge-function secrets to
// the same value n8n sends in x-verify-token (it lives in secrets.md). Missing = fail CLOSED:
// every request is rejected rather than the gate quietly disappearing.
const VERIFY_TOKEN = Deno.env.get("GHL_VERIFY_TOKEN") ?? "";

function pick(src: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = src?.[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") return s;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = new URL(req.url);
  const token = req.headers.get("x-verify-token") ?? url.searchParams.get("token");
  if (token !== VERIFY_TOKEN) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const d = { ...(body.customData as Record<string, unknown> | undefined), ...body };

  const payload = {
    ghl_contact_id: pick(d, "contact_id", "contactId", "ghl_contact_id"),
    phone: pick(d, "phone", "phone_number"),
    email: pick(d, "email"),
    first: pick(d, "first", "first_name", "firstName"),
    last: pick(d, "last", "last_name", "lastName"),
    company_name: pick(d, "company_name", "companyName"),
    source: pick(d, "source"),
  };

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !key) return json({ error: "service env missing" }, 500);

  const res = await fetch(`${supaUrl}/rest/v1/rpc/intake_buyer_tag`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p: payload }),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
