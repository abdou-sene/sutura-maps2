// netlify/functions/check-token.js
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;

  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: "Token manquant" }) };
  }

  const { data, error } = await supabase
    .from("exports")
    .select("paid, commune, expires_at")
    .eq("token", token)
    .single();

  if (error || !data) {
    return { statusCode: 404, body: JSON.stringify({ paid: false, error: "Token introuvable" }) };
  }

  // Vérifier expiration (24h)
  const expired = new Date(data.expires_at) < new Date();
  if (expired) {
    return { statusCode: 200, body: JSON.stringify({ paid: false, error: "Token expiré" }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ paid: data.paid, commune: data.commune }),
  };
};
