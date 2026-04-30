const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;

  if (!token || !token.startsWith("SUT")) {
    return {
      statusCode: 400,
      body: JSON.stringify({ paid: false, error: "Token invalide" }),
    };
  }

  const { data, error } = await supabase
    .from("exports")
    .select("paid, commune, expires_at, used_at")
    .eq("token", token)
    .single();

  if (error || !data) {
    return {
      statusCode: 404,
      body: JSON.stringify({ paid: false, error: "Token introuvable" }),
    };
  }

  // Expiré ?
  if (new Date(data.expires_at) < new Date()) {
    return {
      statusCode: 200,
      body: JSON.stringify({ paid: false, error: "Token expiré (2h)" }),
    };
  }

  // Déjà utilisé ? (protection one-shot)
  if (data.used_at) {
    return {
      statusCode: 200,
      body: JSON.stringify({ paid: false, error: "Token déjà utilisé" }),
    };
  }

  // Marquer comme utilisé si paid=true (one-shot download)
  if (data.paid) {
    await supabase
      .from("exports")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token);
  }

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ paid: data.paid, commune: data.commune }),
  };
};
