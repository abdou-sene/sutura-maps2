const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Fenêtre de téléchargement après paiement (1 heure).
const DOWNLOAD_WINDOW_MS = 60 * 60 * 1000;

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*" };
  const token = event.queryStringParameters?.token;

  if (!token)
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ paid: false, error: "Token manquant" }),
    };

  const { data, error } = await supabase
    .from("exports")
    .select("paid, paid_at, commune, dept, reg, level, maptype, expires_at, user_color, user_author, country, gid")
    .eq("token", token)
    .maybeSingle();

  if (error || !data)
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ paid: false, error: "Token introuvable" }),
    };

  const now = Date.now();

  // Pas encore payé : soit on attend la confirmation, soit le lien de
  // paiement a expiré (48h fixées à la création).
  if (!data.paid) {
    if (data.expires_at && new Date(data.expires_at).getTime() < now) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ paid: false, error: "Lien expiré" }),
      };
    }
    // En attente de confirmation : pas d'erreur, le front continue de surveiller.
    return { statusCode: 200, headers, body: JSON.stringify({ paid: false }) };
  }

  // Payé : téléchargeable pendant 1 heure après le paiement, autant de fois
  // que nécessaire (re-téléchargement jusqu'à expiration).
  if (data.paid_at) {
    const limit = new Date(data.paid_at).getTime() + DOWNLOAD_WINDOW_MS;
    if (now > limit) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          paid: false,
          error: "Lien de téléchargement expiré (1 heure dépassée)",
        }),
      };
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      paid: true,
      commune: data.commune,
      dept: data.dept || null,
      reg: data.reg || null,
      level: data.level || "commune",
      maptype: data.maptype || "localisation",
      color: data.user_color || "#7BA05B",
      author: data.user_author || "Sutura Maps",
      country: data.country || "SN",
      gid: data.gid || null,
    }),
  };
};
