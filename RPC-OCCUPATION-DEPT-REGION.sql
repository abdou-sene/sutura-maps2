-- ============================================================
--  Occupation du sol par DÉPARTEMENT et RÉGION — CACHE + SUBDIVISION
--  À coller dans Supabase (SQL Editor), section par section, dans l'ordre.
--
--  Pourquoi ça bloquait sur les vastes régions (Saint-Louis, Matam, Tamba) :
--  la table occupation_sol a peu de lignes mais ÉNORMES (un multipolygone
--  national par classe). Découper une telle géométrie sur une grande région
--  est très lent et l'index spatial n'aide pas à l'intérieur d'un seul gros
--  polygone.
--
--  Solution : on pré-découpe la couche en petits morceaux indexables
--  (ST_Subdivide). L'index ne récupère alors que les morceaux locaux à la zone,
--  et le découpage devient rapide. On recolle par classe à la fin (sans perte
--  de forme). Puis on met le résultat en cache => lecture instantanée.
-- ============================================================

-- ---------- 0) Couche pré-découpée (UNE fois) ----------
drop table if exists public.occupation_sol_sub;
create table public.occupation_sol_sub as
select "NOM" as nom,
       st_subdivide(st_makevalid(geom), 256) as geom
from public.occupation_sol;

create index if not exists idx_occupation_sub_geom
  on public.occupation_sol_sub using gist (geom);

analyze public.occupation_sol_sub;

-- ---------- 1) Fonction de découpe (rapide, recollée par classe) ----------
-- Lit la couche subdivisée (indexée), prend les morceaux entièrement dans la
-- zone tels quels, découpe seulement ceux de la frontière, puis recolle par
-- classe (st_unaryunion avec micro-grille pour la robustesse). Précision 6.
create or replace function public.occupation_fc(p_zone geometry)
returns jsonb language sql stable as $$
  with z as (select st_makevalid(p_zone) as geom),
  clipped as (
    select o.nom,
           case
             when st_within(o.geom, z.geom) then o.geom
             else st_makevalid(
                    st_collectionextract(
                      st_intersection(o.geom, z.geom), 3
                    )
                  )
           end as geom
    from public.occupation_sol_sub o, z
    where o.geom && z.geom and st_intersects(o.geom, z.geom)
  ),
  dissolved as (
    select nom, st_unaryunion(st_collect(geom), 0.000001) as geom
    from clipped
    where geom is not null and not st_isempty(geom)
    group by nom
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'properties', jsonb_build_object('NOM', nom),
        'geometry', st_asgeojson(geom, 6)::jsonb
      )
    ) filter (where geom is not null and not st_isempty(geom)), '[]'::jsonb)
  )
  from dissolved;
$$;

-- ---------- 2) Table cache ----------
create table if not exists public.occupation_cache (
  level   text not null,            -- 'dept' ou 'region'
  dept    text not null default '', -- '' pour une région
  reg     text not null,
  data    jsonb not null,
  built_at timestamptz default now(),
  primary key (level, dept, reg)
);

-- ---------- 3) Lecture (utilisée par le site) ----------
create or replace function public.get_occupation_par_dept(
  p_dept text, p_reg text
) returns jsonb language sql stable as $$
  select coalesce(
    (select data from public.occupation_cache
       where level = 'dept' and dept = p_dept and reg = p_reg),
    public.occupation_fc(
      (select st_makevalid(geom) from public.departements
         where "DEPT" = p_dept and "REG" = p_reg limit 1)
    )
  );
$$;

create or replace function public.get_occupation_par_region(
  p_reg text
) returns jsonb language sql stable as $$
  select coalesce(
    (select data from public.occupation_cache
       where level = 'region' and dept = '' and reg = p_reg),
    public.occupation_fc(
      (select st_makevalid(geom) from public.regions
         where "REG" = p_reg limit 1)
    )
  );
$$;

-- ============================================================
--  4) CONSTRUCTION DU CACHE (une fois). Donne de la marge :
--    set statement_timeout = '900s';
-- ============================================================

-- 4a) Régions
insert into public.occupation_cache (level, dept, reg, data)
select 'region', '', r."REG", public.occupation_fc(r.geom)
from public.regions r
on conflict (level, dept, reg) do update
  set data = excluded.data, built_at = now();

-- 4b) Départements
insert into public.occupation_cache (level, dept, reg, data)
select 'dept', d."DEPT", d."REG", public.occupation_fc(d.geom)
from public.departements d
on conflict (level, dept, reg) do update
  set data = excluded.data, built_at = now();

-- 4c) Une seule zone si besoin (ex. une vaste région isolée) :
--   set statement_timeout = '900s';
--   insert into public.occupation_cache(level,dept,reg,data)
--   select 'region','', r."REG", public.occupation_fc(r.geom)
--   from public.regions r where r."REG" = 'TAMBACOUNDA'
--   on conflict (level,dept,reg) do update set data=excluded.data, built_at=now();

-- ============================================================
--  5) Vérifs
--    select level, dept, reg, pg_size_pretty(length(data::text)::bigint), built_at
--    from public.occupation_cache order by length(data::text) desc;
-- ============================================================
