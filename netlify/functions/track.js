const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const cut = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: "JSON invalide" };
  }
  const { event: evtName, commune, token } = body;
  if (!evtName) return { statusCode: 400, headers, body: "event requis" };

  const base = {
    event: cut(evtName, 40),
    commune: cut(commune, 120),
    token: cut(token, 80),
  };
  // Détails libres : 10 clés au plus, valeurs simples et courtes.
  let meta = null;
  if (body.meta && typeof body.meta === "object") {
    meta = {};
    Object.entries(body.meta)
      .slice(0, 10)
      .forEach(([k, v]) => {
        if (["string", "number", "boolean"].includes(typeof v))
          meta[cut(k, 30)] = typeof v === "string" ? cut(v, 80) : v;
      });
  }
  const full = {
    ...base,
    visitor_id: cut(body.visitor_id, 40),
    session_id: cut(body.session_id, 40),
    device: cut(body.device, 20),
    source: cut(body.source, 60),
    country: cut(body.country, 8),
    // Pays du visiteur, fourni par Netlify.
    geo: cut(event.headers["x-country"], 8),
    meta,
  };

  let { error } = await supabase.from("analytics").insert(full);
  // Colonnes de suivi pas encore créées (ANALYTICS-PARCOURS.sql non joué) :
  // on enregistre au moins l'événement, comme avant.
  if (error) {
    ({ error } = await supabase.from("analytics").insert(base));
    if (error) console.error("track error:", error.message);
  }

  return { statusCode: 200, headers, body: "OK" };
};
