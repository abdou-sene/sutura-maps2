// netlify/functions/wave-webhook.js
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Wave envoie l'événement de paiement complété
  if (payload.type === "checkout.session.completed") {
    const token = payload.data?.client_reference;

    if (!token) {
      return { statusCode: 400, body: "Missing token" };
    }

    const { error } = await supabase
      .from("exports")
      .update({ paid: true })
      .eq("token", token);

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    console.log(`✅ Paiement confirmé pour token: ${token}`);
  }

  return { statusCode: 200, body: "OK" };
};
