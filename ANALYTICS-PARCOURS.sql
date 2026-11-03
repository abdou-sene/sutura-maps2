-- ============================================================
--  Suivi des parcours visiteurs (tableau de bord admin).
--  - visitor_id : identifiant anonyme du navigateur (persistant)
--  - session_id : visite (30 min d'inactivité = nouvelle session)
--  - device     : mobile / tablette / ordinateur
--  - source     : d'où vient le visiteur (utm_source, site référent, appli)
--  - country    : pays de la carte choisie (SN, BEN…)
--  - geo        : pays du visiteur (détecté par Netlify)
--  - meta       : détails libres (niveau, type de carte…)
--  À coller dans Supabase (léger, additif, sans impact sur l'existant).
-- ============================================================
alter table public.analytics add column if not exists created_at timestamptz default now();
alter table public.analytics add column if not exists visitor_id text;
alter table public.analytics add column if not exists session_id text;
alter table public.analytics add column if not exists device text;
alter table public.analytics add column if not exists source text;
alter table public.analytics add column if not exists country text;
alter table public.analytics add column if not exists geo text;
alter table public.analytics add column if not exists meta jsonb;

create index if not exists analytics_created_at_idx on public.analytics (created_at desc);
create index if not exists analytics_session_idx on public.analytics (session_id);
create index if not exists analytics_event_idx on public.analytics (event);
