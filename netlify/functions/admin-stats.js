const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const DAY = 24 * 3600 * 1000;
const MAX_PAGES = 40; // 40 000 événements au plus par chargement

// Étapes du tunnel, dans l'ordre. Une session compte pour une étape si elle a
// déclenché au moins un des événements listés.
const FUNNEL = [
  ["visit", "Visite", ["visit"]],
  ["zone", "Zone choisie", ["zone_select"]],
  ["gen", "Carte générée", ["generation"]],
  ["pay", "Clic « Payer »", ["pay_click"]],
  ["init", "Envoyé vers le paiement", ["payment_init"]],
  ["paid", "Paiement confirmé", ["paid_confirmed"]],
  ["dl", "Carte récupérée", ["download_auto", "download_click", "download_share"]],
];

const count = (ev) =>
  supabase
    .from("analytics")
    .select("id", { count: "exact", head: true })
    .eq("event", ev);

// Tous les événements depuis `since`, page par page.
async function fetchEvents(since) {
  const rows = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await supabase
      .from("analytics")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(p * 1000, p * 1000 + 999);
    if (error) return { rows, error: error.message };
    rows.push(...data);
    if (data.length < 1000) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

// Regroupe les variantes d'une même source (l.facebook.com, appli Facebook…).
const SOURCES = [
  [/facebook|fb\b|fban/i, "Facebook"],
  [/whatsapp|wa\.me/i, "WhatsApp"],
  [/tiktok/i, "TikTok"],
  [/instagram/i, "Instagram"],
  [/linkedin|lnkd/i, "LinkedIn"],
  [/google/i, "Google"],
  [/^t\.co$|twitter|^x\.com/i, "X (Twitter)"],
  [/bing/i, "Bing"],
  [/snapchat/i, "Snapchat"],
];
const normSource = (s) => {
  if (!s) return null;
  const hit = SOURCES.find(([re]) => re.test(s));
  return hit ? hit[1] : s;
};

const keyOf = (r) => r.session_id || `row-${r.id}`;
const uniq = (rows, f) => new Set(rows.map(f)).size;
const tally = (rows, f, keyFn = keyOf) => {
  // Compte des sessions distinctes par valeur.
  const m = {};
  rows.forEach((r) => {
    const v = f(r);
    if (!v) return;
    (m[v] = m[v] || new Set()).add(keyFn(r));
  });
  return Object.entries(m)
    .map(([k, s]) => [k, s.size])
    .sort((a, b) => b[1] - a[1]);
};

function summarize(rows, paidOrders) {
  const ev = (name) => rows.filter((r) => r.event === name);
  const kept = paidOrders.filter((o) => !o.refunded_at);
  const visitRows = ev("visit");
  return {
    visitors: uniq(visitRows, (r) => r.visitor_id || keyOf(r)),
    sessions: uniq(visitRows, keyOf),
    generations: ev("generation").length,
    pay_clicks: ev("pay_click").length,
    sales: kept.length,
    revenue: kept.reduce((s, o) => s + (o.amount || 2000), 0),
  };
}

exports.handler = async (event) => {
  if (event.headers["x-admin-password"] !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Non autorisé" }) };
  }

  const days = Math.min(90, Math.max(1, parseInt(event.queryStringParameters?.days, 10) || 7));
  const now = Date.now();
  const since = new Date(now - days * DAY).toISOString();
  const sincePrev = new Date(now - 2 * days * DAY).toISOString();

  const [visits, generations, paymentInits, exports_, paidRange, ev] = await Promise.all([
    count("visit"),
    count("generation"),
    count("payment_init"),
    supabase
      .from("exports")
      .select(
        "token, code, commune, dept, reg, maptype, level, amount, paid, paid_at, refunded_at, created_at, user_email, user_author, country",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("exports")
      .select("token, commune, maptype, amount, paid_at, refunded_at")
      .eq("paid", true)
      .gte("paid_at", sincePrev),
    fetchEvents(sincePrev),
  ]);

  // ── Totaux depuis le début (comme avant) ──
  const rows = exports_.data || [];
  const allKept = rows.filter((e) => e.paid && !e.refunded_at);
  const refunded = rows.filter((e) => e.paid && e.refunded_at);
  const totals = {
    visits: visits.count || 0,
    generations: generations.count || 0,
    payment_inits: paymentInits.count || 0,
    paid_total: allKept.length,
    refunded_total: refunded.length,
    revenue: allKept.reduce((s, e) => s + (e.amount || 2000), 0),
  };

  // ── Période choisie vs période précédente ──
  const all = ev.rows || [];
  const cur = all.filter((r) => r.created_at >= since);
  const prev = all.filter((r) => r.created_at < since);
  const paid = paidRange.data || [];
  const paidCur = paid.filter((o) => o.paid_at >= since);
  const paidPrev = paid.filter((o) => o.paid_at < since);

  // ── Courbe : par heure (24 h) ou par jour ──
  const hourly = days === 1;
  const step = hourly ? 3600 * 1000 : DAY;
  const n = hourly ? 24 : days;
  const start = hourly
    ? Math.floor(now / step) * step - (n - 1) * step
    : Math.floor(now / DAY) * DAY - (n - 1) * DAY;
  const series = Array.from({ length: n }, (_, i) => ({
    t: new Date(start + i * step).toISOString(),
    visitors: new Set(),
    generations: 0,
    sales: 0,
  }));
  const slot = (iso) => {
    const i = Math.floor((new Date(iso).getTime() - start) / step);
    return i >= 0 && i < n ? series[i] : null;
  };
  cur.forEach((r) => {
    const s = slot(r.created_at);
    if (!s) return;
    if (r.event === "visit") s.visitors.add(r.visitor_id || keyOf(r));
    if (r.event === "generation") s.generations++;
  });
  paidCur
    .filter((o) => !o.refunded_at)
    .forEach((o) => {
      const s = slot(o.paid_at);
      if (s) s.sales++;
    });

  // ── Tunnel en sessions uniques ──
  const sessionsWith = (events) =>
    new Set(cur.filter((r) => events.includes(r.event)).map(keyOf));
  const funnel = FUNNEL.map(([id, label, events]) => ({
    id,
    label,
    sessions: sessionsWith(events).size,
  }));

  // ── Parcours des sessions récentes ──
  const bySession = {};
  cur
    .filter((r) => r.session_id)
    .forEach((r) => (bySession[r.session_id] = bySession[r.session_id] || []).push(r));
  const visitorSessions = {};
  all
    .filter((r) => r.session_id && r.visitor_id)
    .forEach((r) => (visitorSessions[r.visitor_id] = visitorSessions[r.visitor_id] || new Set()).add(r.session_id));
  const journeys = Object.entries(bySession)
    .map(([sid, evs]) => {
      evs.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const first = evs[0];
      return {
        session: sid,
        visitor: first.visitor_id,
        returning: (visitorSessions[first.visitor_id]?.size || 0) > 1,
        device: evs.find((e) => e.device)?.device || null,
        source: normSource(evs.find((e) => e.source)?.source),
        geo: evs.find((e) => e.geo)?.geo || null,
        start: first.created_at,
        end: evs[evs.length - 1].created_at,
        events: evs.map((e) => ({ e: e.event, c: e.commune, t: e.created_at })),
      };
    })
    .sort((a, b) => (a.end < b.end ? 1 : -1))
    .slice(0, 60);

  // ── Répartitions (sessions uniques) ──
  const visitCur = cur.filter((r) => r.event === "visit");
  const LABEL_TYPE = { localisation: "Localisation", occupation: "Occupation du sol", relief: "Relief" };
  const breakdowns = {
    sources: tally(visitCur, (r) => normSource(r.source)).slice(0, 8),
    devices: tally(visitCur, (r) => r.device),
    geo: tally(visitCur, (r) => r.geo).slice(0, 8),
    map_types: tally(
      cur.filter((r) => r.event === "generation"),
      (r) => LABEL_TYPE[r.meta?.maptype] || r.meta?.maptype,
    ),
    top_generated: tally(
      cur.filter((r) => r.event === "generation"),
      (r) => r.commune,
    ).slice(0, 8),
    top_sold: Object.entries(
      paidCur
        .filter((o) => !o.refunded_at)
        .reduce((m, o) => ((m[o.commune || "?"] = (m[o.commune || "?"] || 0) + 1), m), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  };

  // ── Problèmes ──
  const problemsOf = (name) => cur.filter((r) => r.event === name);
  const problems = {
    download_error: problemsOf("download_error").length,
    carton_error: problemsOf("carton_error").length,
    inapp_browser: uniq(problemsOf("inapp_browser"), keyOf),
    inapp_apps: tally(problemsOf("inapp_browser"), (r) => r.commune),
    last_errors: problemsOf("download_error")
      .slice(0, 5)
      .map((r) => ({ t: r.created_at, msg: r.commune })),
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      days,
      hourly,
      totals,
      current: summarize(cur, paidCur),
      previous: summarize(prev, paidPrev),
      series: series.map((s) => ({ ...s, visitors: s.visitors.size })),
      funnel,
      journeys,
      breakdowns,
      problems,
      // Colonnes de suivi absentes : il faut jouer ANALYTICS-PARCOURS.sql.
      tracking_ready: !ev.error && (cur.length === 0 || cur.some((r) => "session_id" in r)),
      events_error: ev.error || null,
      truncated: !!ev.truncated,
      orders: rows,
    }),
  };
};
