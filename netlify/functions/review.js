const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Avis clients « achat vérifié ».
// - GET                      : avis validés (page d'accueil), mis en cache CDN
// - GET  + mot de passe admin : tous les avis (modération)
// - POST { token, rating, comment?, name? } : dépôt d'un avis, token payé requis
// - POST + mot de passe admin { action: approve|hide|delete, id } : modération
const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const clean = (s, max) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) || null : null;

exports.handler = async (event) => {
  const isAdmin =
    !!process.env.ADMIN_PASSWORD &&
    event.headers["x-admin-password"] === process.env.ADMIN_PASSWORD;

  if (event.httpMethod === "GET") {
    if (isAdmin) {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json(500, { error: error.message });
      return json(200, { reviews: data });
    }
    const { data, error } = await supabase
      .from("reviews")
      .select("rating, comment, name, zone, maptype, created_at")
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(12);
    return json(
      200,
      { reviews: error ? [] : data },
      {
        "Cache-Control": "public, max-age=600",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=900, stale-while-revalidate=86400",
      },
    );
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON invalide" });
  }

  if (isAdmin && body.action) {
    const id = parseInt(body.id, 10);
    if (!id) return json(400, { error: "id requis" });
    let error = null;
    if (body.action === "approve" || body.action === "hide") {
      ({ error } = await supabase
        .from("reviews")
        .update({ approved: body.action === "approve" })
        .eq("id", id));
    } else if (body.action === "delete") {
      ({ error } = await supabase.from("reviews").delete().eq("id", id));
    } else {
      return json(400, { error: `Action inconnue : ${body.action}` });
    }
    if (error) return json(500, { error: error.message });
    return json(200, { success: true });
  }

  const rating = parseInt(body.rating, 10);
  if (!body.token || !(rating >= 1 && rating <= 5)) {
    return json(400, { error: "token et note requis" });
  }

  // Seul un acheteur réel peut laisser un avis.
  const { data: order } = await supabase
    .from("exports")
    .select("token, paid, commune, maptype")
    .eq("token", body.token)
    .maybeSingle();
  if (!order || !order.paid) return json(403, { error: "Commande non payée" });

  // Un avis par commande : un nouvel envoi remplace le précédent et repasse en modération.
  const { error } = await supabase.from("reviews").upsert(
    {
      token: order.token,
      rating,
      comment: clean(body.comment, 600),
      name: clean(body.name, 40),
      zone: order.commune,
      maptype: order.maptype,
      approved: false,
    },
    { onConflict: "token" },
  );
  if (error) {
    console.error("review error:", error.message);
    return json(500, { error: "Enregistrement impossible" });
  }
  return json(200, { success: true });
};
