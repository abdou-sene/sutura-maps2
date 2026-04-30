const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
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

  console.log("PayDunya IPN reçu:", JSON.stringify(payload));

  // PayDunya envoie un hash à vérifier
  const invoiceToken = payload.data?.invoice?.token;
  const status = payload.data?.invoice?.status; // "completed"
  const customToken = payload.data?.custom_data?.token;

  if (!customToken) {
    return { statusCode: 400, body: "Missing token" };
  }

  // Vérifier le statut directement via l'API PayDunya
  if (invoiceToken) {
    const verifyRes = await fetch(
      `https://app.paydunya.com/api/v1/checkout-invoice/confirm/${invoiceToken}`,
      {
        headers: {
          "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
          "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
          "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN,
        },
      },
    );
    const verifyData = await verifyRes.json();

    if (verifyData.status !== "completed") {
      console.log("Paiement non complété:", verifyData.status);
      return { statusCode: 200, body: "Not completed yet" };
    }
  }

  // Mettre à jour Supabase
  const { error } = await supabase
    .from("exports")
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
    })
    .eq("token", customToken);

  if (error) {
    console.error("Supabase update error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }

  console.log(`✅ Paiement validé — token: ${customToken}`);
  return { statusCode: 200, body: "OK" };
};
