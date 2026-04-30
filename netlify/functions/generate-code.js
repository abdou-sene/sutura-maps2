const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n) =>
    Array.from(
      { length: n },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  return `SUT-${part(4)}-${part(4)}`;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  const { commune, dept, reg, email, color, author } = JSON.parse(
    event.body || "{}",
  );

  // Générer un code unique (retry si collision)
  let code,
    attempts = 0;
  while (attempts < 5) {
    code = makeCode();
    const { data } = await supabase
      .from("exports")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (!data) break;
    attempts++;
  }

  const token =
    "DL-" + Math.random().toString(36).substring(2, 14).toUpperCase();

  const { error } = await supabase.from("exports").insert({
    code,
    token,
    commune,
    dept,
    reg,
    user_email: email || null,
    user_color: color || "#7BA05B",
    user_author: author || "Sutura Maps",
    paid: false,
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });

  if (error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };

  // Tracker l'événement
  await supabase
    .from("analytics")
    .insert({ event: "payment_init", commune, token: code });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ code, token }),
  };
};
