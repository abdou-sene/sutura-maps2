-- ============================================================
--  Occupation du sol par ZONE ÉCO-GÉOGRAPHIQUE
--  À coller dans Supabase. Prérequis déjà en place :
--   - occupation_sol_sub (couche subdivisée + index GIST)
--   - occupation_fc(p_zone geometry)  (fonction de découpe)
--   - occupation_cache (table de cache)
--
--  IMPORTANT : importe tes zones éco dans une table nommée EXACTEMENT
--  public.zones_eco, avec une colonne nom (text) et une colonne geom.
-- ============================================================

-- 0) Index + géométries valides (après import)
create index if not exists idx_zones_eco_geom
  on public.zones_eco using gist (geom);

update public.zones_eco
set geom = st_multi(st_collectionextract(st_makevalid(geom), 3))
where not st_isvalid(geom);

-- 1) Lecture (cache d'abord, repli sur calcul à la volée)
create or replace function public.get_occupation_par_eco(p_zone text)
returns jsonb language sql stable as $$
  select coalesce(
    (select data from public.occupation_cache
       where level = 'eco' and dept = '' and reg = p_zone),
    public.occupation_fc(
      (select st_makevalid(geom) from public.zones_eco where nom = p_zone limit 1)
    )
  );
$$;

-- 2) Liste des zones (pour remplir le menu déroulant du site)
create or replace function public.list_zones_eco()
returns table(nom text) language sql stable as $$
  select nom from public.zones_eco order by nom;
$$;

-- 3) Construction du cache des zones éco (une fois, peut être long)
--    set statement_timeout = '900s';
insert into public.occupation_cache (level, dept, reg, data)
select 'eco', '', z.nom, public.occupation_fc(z.geom)
from public.zones_eco z
on conflict (level, dept, reg) do update
  set data = excluded.data, built_at = now();

-- 4) Vérif
--   select reg, pg_size_pretty(length(data::text)::bigint)
--   from public.occupation_cache where level='eco' order by 2 desc;
-- ============================================================
