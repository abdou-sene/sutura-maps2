// netlify/functions/create-payment.js
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { commune } = JSON.parse(event.body);

  // Générer un token unique
  const token = "SUT" + Math.random().toString(36).substring(2, 10).toUpperCase();

  // Sauvegarder dans Supabase
  const { error } = await supabase
    .from("exports")
    .insert({ token, commune, paid: false });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  // Créer le lien Wave Checkout
  const waveResponse = await fetch("https://api.wave.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: "2000",
      currency: "XOF",
      error_url: `${process.env.APP_URL}?token=${token}&status=error`,
      success_url: `${process.env.APP_URL}?token=${token}&status=success`,
      client_reference: token,
    }),
  });

  const waveData = await waveResponse.json();

  if (!waveData.wave_launch_url) {
    return { statusCode: 500, body: JSON.stringify({ error: "Wave error", detail: waveData }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      token,
      payment_url: waveData.wave_launch_url,
    }),
  };
};
