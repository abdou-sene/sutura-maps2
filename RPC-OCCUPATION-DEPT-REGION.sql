-- ============================================================
--  Occupation du sol par DÉPARTEMENT et par RÉGION
--  À coller dans Supabase (SQL Editor). Remplace les versions précédentes.
--
--  La zone vient directement des tables departements / regions
--  (plus de reconstruction par union des communes).
--
--  Dissolution par CLASSE (un polygone par classe) pour alléger.
--  Union robuste via ST_UnaryUnion(..., gridSize) pour éviter les
--  erreurs GEOS de topologie.
--
--  À VÉRIFIER si erreur "column ... does not exist" :
--   - le nom de la colonne géométrie (ici "geom") ;
--   - que la table departements a bien les colonnes "DEPT" et "REG" ;
--   - que la table regions a bien la colonne "REG".
--  Adapte les noms ci-dessous si besoin.
-- ============================================================

-- ---------- DÉPARTEMENT ----------  (grille ~ 0.0004° ≈ 45 m)
create or replace function public.get_occupation_par_dept(
  p_dept text, p_reg text
) returns jsonb language sql stable as $$
  with zone as (
    select st_makevalid(geom) as geom
    from public.departements
    where "DEPT" = p_dept and "REG" = p_reg
    limit 1
  ),
  clipped as (
    select o."NOM" as nom,
           st_makevalid(
             st_collectionextract(
               st_intersection(st_makevalid(o.geom), z.geom), 3
             )
           ) as geom
    from public.occupation_du_sol o, zone z
    where st_intersects(o.geom, z.geom)
  ),
  dissolved as (
    select nom, st_unaryunion(st_collect(geom), 0.0004) as geom
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
        'geometry', st_asgeojson(geom, 5)::jsonb
      )
    ) filter (where geom is not null and not st_isempty(geom)), '[]'::jsonb)
  )
  from dissolved;
$$;

-- ---------- RÉGION ----------  (grille ~ 0.0009° ≈ 100 m)
create or replace function public.get_occupation_par_region(
  p_reg text
) returns jsonb language sql stable as $$
  with zone as (
    select st_makevalid(geom) as geom
    from public.regions
    where "REG" = p_reg
    limit 1
  ),
  clipped as (
    select o."NOM" as nom,
           st_makevalid(
             st_collectionextract(
               st_intersection(st_makevalid(o.geom), z.geom), 3
             )
           ) as geom
    from public.occupation_du_sol o, zone z
    where st_intersects(o.geom, z.geom)
  ),
  dissolved as (
    select nom, st_unaryunion(st_collect(geom), 0.0009) as geom
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
        'geometry', st_asgeojson(geom, 5)::jsonb
      )
    ) filter (where geom is not null and not st_isempty(geom)), '[]'::jsonb)
  )
  from dissolved;
$$;

-- ============================================================
--  Test :
--    select pg_size_pretty(length(get_occupation_par_region('THIES')::text)::bigint);
--    select pg_size_pretty(length(get_occupation_par_dept('MBOUR','THIES')::text)::bigint);
--  Si > ~8 s : monte la grille (0.0009 -> 0.0015 -> 0.002).
-- ============================================================
