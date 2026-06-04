const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  if (!process.env.BICTORYS_WEBHOOK_SECRET) {
    console.error("BICTORYS_WEBHOOK_SECRET non configuré");
    return { statusCode: 500, body: "Webhook non configuré" };
  }

  // Bictorys envoie soit X-Secret-Key (clé statique) soit X-Webhook-Signature (HMAC)
  const secretKey = event.headers["x-secret-key"];
  const hmacSig = event.headers["x-webhook-signature"];

  if (secretKey) {
    // Comparaison timing-safe de la clé statique
    const expected = Buffer.from(process.env.BICTORYS_WEBHOOK_SECRET);
    const received = Buffer.from(secretKey);
    if (expected.length !== received.length ||
        !crypto.timingSafeEqual(expected, received)) {
      console.warn("X-Secret-Key invalide");
      return { statusCode: 401, body: "Unauthorized" };
    }
  } else if (hmacSig) {
    const expected = crypto
      .createHmac("sha256", process.env.BICTORYS_WEBHOOK_SECRET)
      .update(event.body)
      .digest("hex");
    const received = Buffer.from(hmacSig);
    const expectedBuf = Buffer.from(expected);
    if (received.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(received, expectedBuf)) {
      console.warn("X-Webhook-Signature invalide");
      return { statusCode: 401, body: "Unauthorized" };
    }
  } else {
    console.warn("Aucun header d'authentification Bictorys");
    return { statusCode: 401, body: "Unauthorized" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const token = payload.paymentReference;
  const status = payload.status;

  if (!token) return { statusCode: 400, body: "Missing paymentReference" };

  const isSuccess = ["succeeded", "authorized"].includes(status);

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
