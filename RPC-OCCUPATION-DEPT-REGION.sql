-- ============================================================
--  Occupation du sol par DÉPARTEMENT et par RÉGION
--  À coller dans Supabase (SQL Editor), une fois.
--
--  Principe anti-surcharge : on dissout l'occupation PAR CLASSE
--  (un seul polygone multipart par classe), puis on simplifie et
--  on réduit la précision. Sans ça, une région renvoie des milliers
--  de polygones et dépasse la limite de réponse des fonctions Netlify.
--
--  La zone est l'union des communes (table communes, fiable car elle
--  porte DEPT et REG). Pense à avoir un index spatial sur communes :
--    create index if not exists idx_communes_geom
--      on public.communes using gist (geom);
-- ============================================================

-- ---------- DÉPARTEMENT ----------
create or replace function public.get_occupation_par_dept(
  p_dept text, p_reg text
) returns jsonb language sql stable as $$
  with zone as (
    select st_makevalid(st_union(geom)) as geom
    from public.communes
    where "DEPT" = p_dept and "REG" = p_reg
  ),
  clipped as (
    select o."NOM" as nom,
           st_collectionextract(
             st_intersection(st_makevalid(o.geom), z.geom), 3
           ) as geom
    from public.occupation_du_sol o, zone z
    where st_intersects(o.geom, z.geom)
  ),
  dissolved as (
    select nom, st_union(geom) as geom
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
        'geometry', st_asgeojson(
          st_simplifypreservetopology(geom, 0.0006), 5
        )::jsonb
      )
    ), '[]'::jsonb)
  )
  from dissolved;
$$;

-- ---------- RÉGION ----------
-- Tolérance de simplification plus élevée (zone plus large).
create or replace function public.get_occupation_par_region(
  p_reg text
) returns jsonb language sql stable as $$
  with zone as (
    select st_makevalid(st_union(geom)) as geom
    from public.communes
    where "REG" = p_reg
  ),
  clipped as (
    select o."NOM" as nom,
           st_collectionextract(
             st_intersection(st_makevalid(o.geom), z.geom), 3
           ) as geom
    from public.occupation_du_sol o, zone z
    where st_intersects(o.geom, z.geom)
  ),
  dissolved as (
    select nom, st_union(geom) as geom
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
        'geometry', st_asgeojson(
          st_simplifypreservetopology(geom, 0.0015), 5
        )::jsonb
      )
    ), '[]'::jsonb)
  )
  from dissolved;
$$;

-- ============================================================
--  Tests de poids (doit rester sous ~5 Mo pour Netlify) :
--    select pg_size_pretty(length(get_occupation_par_dept('BAMBEY','DIOURBEL')::text)::bigint);
--    select pg_size_pretty(length(get_occupation_par_region('DIOURBEL')::text)::bigint);
--  Si trop lourd ou trop lent : augmente la tolérance (0.0015 -> 0.003 ...).
-- ============================================================
