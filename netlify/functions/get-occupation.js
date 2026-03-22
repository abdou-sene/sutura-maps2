const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { commune, dept, reg, level } = JSON.parse(event.body);

  // Déterminer le niveau effectif si non fourni explicitement
  const effectiveLevel =
    level || (commune ? "commune" : dept ? "dept" : reg ? "region" : null);

  if (!effectiveLevel) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Paramètres insuffisants — fournissez au moins reg",
      }),
    };
  }

  let data, error;

  if (effectiveLevel === "commune") {
    // ── Niveau commune ──
    if (!commune || !dept || !reg) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "commune, dept et reg sont requis pour le niveau commune",
        }),
      };
    }
    ({ data, error } = await supabase.rpc("get_occupation_par_commune", {
      p_commune: commune,
      p_dept: dept,
      p_reg: reg,
    }));
  } else if (effectiveLevel === "dept") {
    // ── Niveau département ──
    if (!dept || !reg) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "dept et reg sont requis pour le niveau département",
        }),
      };
    }
    ({ data, error } = await supabase.rpc("get_occupation_par_dept", {
      p_dept: dept,
      p_reg: reg,
    }));
  } else if (effectiveLevel === "region") {
    // ── Niveau région ──
    if (!reg) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "reg est requis pour le niveau région" }),
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
