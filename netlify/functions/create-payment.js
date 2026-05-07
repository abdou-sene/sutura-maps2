// netlify/functions/create-payment.js
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  const { commune, dept, reg, color, author, email } = JSON.parse(
    event.body || "{}",
  );

  // 1. Générer token interne
  const token =
    "DL-" + Math.random().toString(36).substring(2, 14).toUpperCase();
  const code =
    "SUT-" +
    Math.random().toString(36).substring(2, 6).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 6).toUpperCase();

  // 2. Sauvegarder en base
  const { error: dbError } = await supabase.from("exports").insert({
    token,
    code,
    commune,
    dept,
    reg,
    user_email: email || null,
    user_color: color || "#7BA05B",
    user_author: author || "Sutura Maps",
    paid: false,
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });

  if (dbError) {
    console.error("Supabase error:", dbError);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: dbError.message }),
    };
  }

  // 3. Créer session Bictorys Checkout
  const bictorysRes = await fetch("https://api.bictorys.com/pay/v1/charges", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.BICTORYS_API_KEY,
    },
    body: JSON.stringify({
      amount: 2000,
      currency: "XOF",
      country: "SN",
      merchantReference: token, // ton token = référence unique
      successRedirectUrl: `${process.env.APP_URL}/map.html?token=${token}&status=success`,
      ErrorRedirectUrl: `${process.env.APP_URL}/map.html?token=${token}&status=error`,
      customer: {
        name: author || "Client Sutura Maps",
        email: email || "client@suturamaps.com",
        city: "Dakar",
        country: "SN",
        locale: "fr-FR",
      },
      orderDetails: [
        {
          name: `Carte commune de ${commune}`,
          price: 2000,
          quantity: 1,
          taxRate: 0,
        },
      ],
    }),
  });

  const bictorysData = await bictorysRes.json();
  console.log("Bictorys response:", JSON.stringify(bictorysData));

  // Bictorys retourne un redirectUrl ou paymentUrl
  const paymentUrl =
    bictorysData.redirectUrl ||
    bictorysData.paymentUrl ||
    bictorysData.checkoutUrl;

  if (!paymentUrl) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Bictorys n'a pas retourné d'URL",
        detail: bictorysData,
      }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ token, code, payment_url: paymentUrl }),
  };
};

const bictorysData = await bictorysRes.json();

// LOG COMPLET — à supprimer après debug
console.log("Status HTTP:", bictorysRes.status);
console.log("Bictorys FULL response:", JSON.stringify(bictorysData, null, 2));

// Chercher l'URL dans tous les champs possibles
const paymentUrl =
  bictorysData.redirectUrl ||
  bictorysData.paymentUrl ||
  bictorysData.checkoutUrl ||
  bictorysData.url ||
  bictorysData.payment_url ||
  bictorysData.checkout_url ||
  bictorysData.data?.redirectUrl ||
  bictorysData.data?.paymentUrl ||
  bictorysData.data?.url ||
  bictorysData.data?.checkoutUrl;

console.log("URL trouvée:", paymentUrl);
