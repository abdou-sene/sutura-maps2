const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { commune, dept, reg } = JSON.parse(event.body);

  // 1. Générer un token unique côté serveur
  const token =
    "SUT" +
    Math.random().toString(36).substring(2, 10).toUpperCase() +
    Date.now().toString(36).toUpperCase();

  // 2. Sauvegarder en base AVANT le paiement
  const { error: dbError } = await supabase.from("exports").insert({
    token,
    commune,
    dept,
    reg,
    paid: false,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2h
    created_at: new Date().toISOString(),
  });

  if (dbError) {
    console.error("Supabase insert error:", dbError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erreur création token" }),
    };
  }

  // 3. Créer la session PayDunya
  const paydunyaPayload = {
    invoice: {
      total_amount: 2000,
      description: `Carte Sutura Maps — Commune de ${commune}`,
    },
    store: {
      name: "Sutura Maps",
      tagline: "Cartographiez avec dignité",
    },
    actions: {
      cancel_url: `${process.env.APP_URL}/map.html?token=${token}&status=cancel`,
      return_url: `${process.env.APP_URL}/map.html?token=${token}&status=success`,
      callback_url: `${process.env.APP_URL}/.netlify/functions/paydunya-webhook`,
    },
    custom_data: {
      token,
      commune,
    },
  };

  const pdRes = await fetch(
    "https://app.paydunya.com/api/v1/checkout-invoice/create",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
        "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
        "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN,
      },
      body: JSON.stringify(paydunyaPayload),
    },
  );

  const pdData = await pdRes.json();

  if (pdData.response_code !== "00") {
    console.error("PayDunya error:", pdData);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Erreur PayDunya",
        detail: pdData.response_text,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({
      token,
      payment_url: pdData.response_text, // URL checkout PayDunya
    }),
  };
};
