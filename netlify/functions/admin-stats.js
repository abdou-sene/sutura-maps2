const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  // Auth simple
  if (event.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
  }

  const [visits, generations, paymentInits, exports_] = await Promise.all([
    supabase
      .from("analytics")
      .select("id", { count: "exact" })
      .eq("event", "visit"),
    supabase
      .from("analytics")
      .select("id", { count: "exact" })
      .eq("event", "generation"),
    supabase
      .from("analytics")
      .select("id", { count: "exact" })
      .eq("event", "payment_init"),
    supabase
      .from("exports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const paid = exports_.data?.filter((e) => e.paid) || [];
  const pending = exports_.data?.filter((e) => !e.paid) || [];

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({
      stats: {
        visits: visits.count || 0,
        generations: generations.count || 0,
        payment_inits: paymentInits.count || 0,
        paid_total: paid.length,
        revenue: paid.length * 2000,
      },
      pending,
      paid: paid.slice(0, 20),
    }),
  };
};
