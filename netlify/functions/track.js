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

  const { event: evtName, commune, token } = JSON.parse(event.body || "{}");

  await supabase.from("analytics").insert({
    event: evtName,
    commune: commune || null,
    token: token || null,
  });

  return { statusCode: 200, headers, body: "OK" };
};
