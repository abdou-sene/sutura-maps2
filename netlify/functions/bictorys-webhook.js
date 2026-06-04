const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  // Vérification signature Bictorys
  if (!process.env.BICTORYS_WEBHOOK_SECRET) {
    console.error("BICTORYS_WEBHOOK_SECRET non configuré — webhook refusé");
    return { statusCode: 500, body: "Webhook non configuré" };
  }

  const signature =
    event.headers["x-bictorys-signature"] ||
    event.headers["x-webhook-signature"] ||
    event.headers["bictorys-signature"];

  if (!signature) {
    console.warn("Signature absente — requête rejetée");
    return { statusCode: 401, body: "Signature manquante" };
  }

  const expected = crypto
    .createHmac("sha256", process.env.BICTORYS_WEBHOOK_SECRET)
    .update(event.body)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    console.warn("Signature invalide — requête rejetée");
    return { statusCode: 401, body: "Invalid signature" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const token = payload.merchantReference || payload.data?.merchantReference;
  const status = payload.status || payload.data?.status;

  if (!token) return { statusCode: 400, body: "Missing merchantReference" };

  const isSuccess = ["SUCCESS", "COMPLETED", "success", "completed"].includes(status);

  if (isSuccess) {
    const { data: existing } = await supabase
      .from("exports")
      .select("paid")
      .eq("token", token)
      .maybeSingle();

    if (existing?.paid) {
      return { statusCode: 200, body: "Already processed" };
    }

    const { error } = await supabase
      .from("exports")
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq("token", token);

    if (error) {
      console.error("Supabase update error:", error.message);
      return { statusCode: 500, body: "DB error" };
    }

    console.log(`Paiement validé — token: ${token}`);
  }

  return { statusCode: 200, body: "OK" };
};
