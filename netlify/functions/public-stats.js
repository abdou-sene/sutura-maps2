const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Chiffre public affiché près du bouton de paiement : cartes réellement
// livrées (payées, non remboursées). Mis en cache 1 h par le CDN Netlify pour
// ne pas consommer une invocation par visiteur.
exports.handler = async () => {
  const { count, error } = await supabase
    .from("exports")
    .select("token", { count: "exact", head: true })
    .eq("paid", true)
    .is("refunded_at", null);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
    },
    body: JSON.stringify({ delivered: error ? null : count || 0 }),
  };
};
