const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
  }

  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  const { code } = JSON.parse(event.body || "{}");
  if (!code)
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Code manquant" }),
    };

  const { data, error } = await supabase
    .from("exports")
    .select("*")
    .eq("code", code.toUpperCase().trim())
    .maybeSingle();

  if (error || !data)
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Code introuvable" }),
    };

  if (data.paid)
    return {
      statusCode: 200,
      body: JSON.stringify({
        already_paid: true,
        commune: data.commune,
        download_url: `${process.env.APP_URL}/map.html?token=${data.token}`,
      }),
    };

  // Marquer comme payé
  await supabase
    .from("exports")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
    })
    .eq("code", code.toUpperCase().trim());

  const downloadUrl = `${process.env.APP_URL}/map.html?token=${data.token}`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      commune: data.commune,
      email: data.user_email,
      download_url: downloadUrl,
    }),
  };
};
