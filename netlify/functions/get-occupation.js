const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  // Gestion CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { commune, dept, reg, level } = JSON.parse(event.body);

  const effectiveLevel =
    level || (commune ? "commune" : dept ? "dept" : "region");

  let data, error;

  if (effectiveLevel === "commune") {
    if (!reg) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Paramètres manquants" }),
      };
    }
    ({ data, error } = await supabase.rpc("get_occupation_par_commune", {
      p_commune: commune,
      p_dept: dept,
      p_reg: reg,
    }));
  } else if (effectiveLevel === "dept") {
    if (!dept || !reg) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "dept et reg requis" }),
      };
    }
    ({ data, error } = await supabase.rpc("get_occupation_par_dept", {
      p_dept: dept,
      p_reg: reg,
    }));
  } else if (effectiveLevel === "region") {
    if (!reg) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "reg requis" }),
      };
    }
    ({ data, error } = await supabase.rpc("get_occupation_par_region", {
      p_reg: reg,
    }));
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Niveau inconnu : ${effectiveLevel}` }),
    };
  }

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
};
