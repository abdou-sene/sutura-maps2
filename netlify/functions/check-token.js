const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token)
    return {
      statusCode: 400,
      body: JSON.stringify({ paid: false, error: "Token manquant" }),
    };

  const { data, error } = await supabase
    .from("exports")
    .select("paid, commune, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data)
    return {
      statusCode: 404,
      body: JSON.stringify({ paid: false, error: "Token introuvable" }),
    };

  if (new Date(data.expires_at) < new Date())
    return {
      statusCode: 200,
      body: JSON.stringify({ paid: false, error: "Lien expiré" }),
    };

  if (data.used_at)
    return {
      statusCode: 200,
      body: JSON.stringify({ paid: false, error: "Déjà téléchargé" }),
    };

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
