import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Authorization required" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/functions\/v1\/metabolic-api/, "").replace(/^\/+/, "");

  try {
    if (route === "me" || route === "") {
      const { data: profile, error } = await supabase
        .from("metabolic_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return json({ user: { id: user.id, email: user.email }, profile });
    }

    if (route === "clients" && req.method === "GET") {
      const { data, error } = await supabase
        .from("metabolic_clients")
        .select("*")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return json({ data });
    }

    if (route === "dashboard" && req.method === "GET") {
      const [clients, reports, checkins, notes] = await Promise.all([
        supabase.from("metabolic_clients").select("id", { count: "exact", head: true }),
        supabase.from("metabolic_reports").select("id", { count: "exact", head: true }),
        supabase.from("metabolic_checkins").select("id", { count: "exact", head: true }),
        supabase.from("metabolic_notes").select("id", { count: "exact", head: true }),
      ]);
      for (const result of [clients, reports, checkins, notes]) if (result.error) throw result.error;
      return json({
        clients: clients.count ?? 0,
        reports: reports.count ?? 0,
        checkins: checkins.count ?? 0,
        notes: notes.count ?? 0,
      });
    }

    return json({ error: "Route not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
});
