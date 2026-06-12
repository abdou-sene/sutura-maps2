const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

exports.handler = async (event) => {
  if (event.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
  }

  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [visits, generations, paymentInits, exports_] = await Promise.all([
    supabase
      .from("analytics")
      .select("id", { count: "exact", head: true })
      .eq("event", "visit"),
    supabase
      .from("analytics")
      .select("id", { count: "exact", head: true })
      .eq("event", "generation"),
    supabase
      .from("analytics")
      .select("id", { count: "exact", head: true })
      .eq("event", "payment_init"),
    supabase
      .from("exports")
      .select(
        "token, code, commune, dept, reg, maptype, level, amount, paid, paid_at, refunded_at, created_at, user_email, user_author",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const rows = exports_.data || [];
  const paid = rows.filter((e) => e.paid);
  const amountOf = (e) => e.amount || 2000;

  // Revenus nets : les commandes remboursées ne comptent pas.
  const kept = paid.filter((e) => !e.refunded_at);
  const refunded = paid.filter((e) => e.refunded_at);
  const revenue = kept.reduce((s, e) => s + amountOf(e), 0);
  const paid7d = kept.filter((e) => e.paid_at && e.paid_at >= since7d);
  const revenue7d = paid7d.reduce((s, e) => s + amountOf(e), 0);

  // Top zones payées (max 6)
  const byZone = {};
  kept.forEach((e) => {
    const k = e.commune || "?";
    byZone[k] = (byZone[k] || 0) + 1;
  });
  const topZones = Object.entries(byZone)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([zone, count]) => ({ zone, count }));

  // Répartition payés par type de carte
  const byType = {};
  kept.forEach((e) => {
    const k = e.maptype || "localisation";
    byType[k] = (byType[k] || 0) + 1;
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stats: {
        visits: visits.count || 0,
        generations: generations.count || 0,
        payment_inits: paymentInits.count || 0,
        paid_total: kept.length,
        refunded_total: refunded.length,
        revenue,
        paid_7d: paid7d.length,
        revenue_7d: revenue7d,
      },
      top_zones: topZones,
      by_type: byType,
      orders: rows,
    }),
  };
};
