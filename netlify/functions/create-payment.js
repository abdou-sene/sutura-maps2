const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const ALLOWED_ORIGIN = process.env.APP_URL || "https://sutura-maps.netlify.app";

function randomId(prefix, len) {
  return prefix + crypto.randomBytes(len).toString("hex").toUpperCase();
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: "Method Not Allowed" };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON invalide" }) };
  }

  const { commune, dept, reg, color, author, email } = body;

  if (!commune || typeof commune !== "string" || commune.trim().length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Paramètre 'commune' requis" }),
    };
  }

  const token = randomId("DL-", 8);
  const code = `SUT-${randomId("", 3)}-${randomId("", 3)}`;

  const { error: dbError } = await supabase.from("exports").insert({
    token,
    code,
    commune: commune.trim(),
    dept: dept || null,
    reg: reg || null,
    user_email: email || null,
    user_color: color || "#7BA05B",
    user_author: author || "Sutura Maps",
    paid: false,
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });

  if (dbError) {
    console.error("Supabase insert error:", dbError.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur création commande" }),
    };
  }

  let bictorysRes, bictorysData;
  try {
    bictorysRes = await fetch("https://api.bictorys.com/pay/v1/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.BICTORYS_API_KEY,
      },
      body: JSON.stringify({
        amount: 2000,
        currency: "XOF",
        country: "SN",
        merchantReference: token,
        successRedirectUrl: `${ALLOWED_ORIGIN}/map.html?token=${token}&status=success`,
        errorRedirectUrl: `${ALLOWED_ORIGIN}/map.html?token=${token}&status=error`,
        customer: {
          name: author || "Client Sutura Maps",
          email: email || "client@suturamaps.com",
          city: "Dakar",
          country: "SN",
          locale: "fr-FR",
        },
        orderDetails: [
          {
            name: `Carte commune de ${commune.trim()}`,
            price: 2000,
            quantity: 1,
            taxRate: 0,
          },
        ],
      }),
    });
    bictorysData = await bictorysRes.json();
  } catch (err) {
    console.error("Bictorys fetch error:", err.message);
    await supabase.from("exports").delete().eq("token", token);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Service de paiement indisponible" }),
    };
  }

  if (!bictorysRes.ok) {
    console.error("Bictorys API error:", bictorysRes.status, bictorysData?.message);
    await supabase.from("exports").delete().eq("token", token);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Erreur service de paiement" }),
    };
  }

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

  if (!paymentUrl) {
    console.error("Bictorys: aucune URL de paiement dans la réponse");
    await supabase.from("exports").delete().eq("token", token);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Bictorys n'a pas retourné d'URL de paiement" }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ token, code, payment_url: paymentUrl }),
  };
};
