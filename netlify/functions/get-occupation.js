const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { commune, dept, reg } = JSON.parse(event.body);

  if (!commune || !dept || !reg) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Paramètres manquants" }),
    };
  }

  const { data, error } = await supabase.rpc("get_occupation_par_commune", {
    p_commune: commune,
    p_dept: dept,
    p_reg: reg,
  });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
};
