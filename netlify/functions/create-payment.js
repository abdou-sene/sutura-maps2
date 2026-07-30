const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const APP_URL = process.env.APP_URL || "https://sutura-maps.netlify.app";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": APP_URL,
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

  const { commune, dept, reg, color, author, client, maptype, level } = body;
  // Multi-pays : pour les pays GADM, la zone est identifiée par son code GID.
  const country = typeof body.country === "string" ? body.country : "SN";
  const gid = typeof body.gid === "string" ? body.gid : null;

  // Prix calculé CÔTÉ SERVEUR (jamais reçu du navigateur) selon le type de
  // carte et le niveau. Occupation et relief : paliers dept/région. Sinon 2000.
  const mt =
    maptype === "occupation" || maptype === "relief" ? maptype : "localisation";
  const lvl =
    level === "region" ? "region" : level === "dept" ? "dept" : "commune";
  function priceFor(t, l) {
    if ((t === "occupation" || t === "relief") && l === "dept") return 4000;
    if ((t === "occupation" || t === "relief") && l === "region") return 5000;
    return 2000;
  }
  const amount = priceFor(mt, lvl);

  // Sur ordinateur, le paiement s'ouvre dans un nouvel onglet ; on marque le
  // retour avec tab=1 pour que cet onglet n'enclenche pas un second
  // téléchargement (l'onglet d'origine s'en charge déjà).
  const tabMarker = client === "desktop" ? "&tab=1" : "";

  if (!commune || typeof commune !== "string" || commune.trim().length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Paramètre 'commune' requis" }),
    };
  }

  const token = "DL-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const code = "SUT-" + crypto.randomBytes(3).toString("hex").toUpperCase()
             + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const { error: dbError } = await supabase.from("exports").insert({
    token,
    code,
    commune: commune.trim(),
    dept: dept || null,
    reg: reg || null,
    user_color: color || "#7BA05B",
    user_author: author || "Sutura Maps",
    maptype: mt,
    level: lvl,
    amount,
    country,
    gid,
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
        amount,
        currency: "XOF",
        country: "SN",
        paymentReference: token,
        successRedirectUrl: `${APP_URL}/map.html?token=${token}&status=success${tabMarker}`,
        ErrorRedirectUrl: `${APP_URL}/map.html?token=${token}&status=error`,
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
    console.error("Bictorys API error:", bictorysRes.status, JSON.stringify(bictorysData));
    await supabase.from("exports").delete().eq("token", token);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Erreur service de paiement", detail: bictorysData }),
    };
  }

  const paymentUrl = bictorysData.redirectUrl || bictorysData.link;

  if (!paymentUrl) {
    console.error("Bictorys: aucune URL dans la réponse:", JSON.stringify(bictorysData));
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
