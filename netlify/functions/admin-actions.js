const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Actions admin sur une commande, identifiée par son token.
// - mark-paid   : marque payé (déclenche la fenêtre de téléchargement 1 h)
// - mark-unpaid : annule le paiement
// - extend      : relance la fenêtre de téléchargement (paid_at = maintenant)
// - refund      : marque remboursé (garantie satisfait ou remboursé)
// - unrefund    : annule un remboursement marqué par erreur
// - delete      : supprime la commande
exports.handler = async (event) => {
  if (event.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON invalide" }) };
  }

  const { action, token } = body;
  if (!action || !token) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "action et token requis" }),
    };
  }

  const { data: row } = await supabase
    .from("exports")
    .select("token, paid, commune")
    .eq("token", token)
    .maybeSingle();

  if (!row) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Commande introuvable" }),
    };
  }

  let error = null;

  if (action === "mark-paid" || action === "extend") {
    ({ error } = await supabase
      .from("exports")
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq("token", token));
  } else if (action === "mark-unpaid") {
    ({ error } = await supabase
      .from("exports")
      .update({ paid: false, paid_at: null })
      .eq("token", token));
  } else if (action === "refund") {
    ({ error } = await supabase
      .from("exports")
      .update({ refunded_at: new Date().toISOString() })
      .eq("token", token));
  } else if (action === "unrefund") {
    ({ error } = await supabase
      .from("exports")
      .update({ refunded_at: null })
      .eq("token", token));
  } else if (action === "delete") {
    ({ error } = await supabase.from("exports").delete().eq("token", token));
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Action inconnue : ${action}` }),
    };
  }

  if (error) {
    console.error("admin-actions error:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, action, token }),
  };
};
