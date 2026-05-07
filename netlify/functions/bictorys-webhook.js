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
  const signature =
    event.headers["x-bictorys-signature"] ||
    event.headers["x-webhook-signature"] ||
    event.headers["bictorys-signature"];

  if (signature && process.env.BICTORYS_WEBHOOK_SECRET) {
    const expected = crypto
      .createHmac("sha256", process.env.BICTORYS_WEBHOOK_SECRET)
      .update(event.body)
      .digest("hex");

    if (signature !== expected) {
      console.warn("Signature invalide — requête rejetée");
      return { statusCode: 401, body: "Invalid signature" };
    }
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  console.log("Bictorys webhook reçu:", JSON.stringify(payload));

  const token = payload.merchantReference || payload.data?.merchantReference;
  const status = payload.status || payload.data?.status;

  if (!token) return { statusCode: 400, body: "Missing merchantReference" };

  const isSuccess = ["SUCCESS", "COMPLETED", "success", "completed"].includes(
    status,
  );

  if (isSuccess) {
    const { error } = await supabase
      .from("exports")
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq("token", token);

    if (error) {
      console.error("Supabase update error:", error);
      return { statusCode: 500, body: error.message };
    }

    console.log(`✅ Paiement validé — token: ${token}`);
  }

  return { statusCode: 200, body: "OK" };
};
