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

-- 2 bis) Contours simplifiés de toutes les zones (FeatureCollection GeoJSON).
--   Sert à dessiner les zones éco LIMITROPHES autour de la zone d'étude.
--   Géométrie allégée (~0.002°) : on ne veut que le contexte, pas le détail.
create or replace function public.zones_eco_fc()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'properties', jsonb_build_object('nom', nom),
        'geometry', st_asgeojson(
          st_simplifypreservetopology(st_makevalid(geom), 0.002), 6
        )::jsonb
      )
    ), '[]'::jsonb)
  )
  from public.zones_eco;
$$;

-- 3) Construction du cache des zones éco (une fois, peut être long)
--    set statement_timeout = '900s';
insert into public.occupation_cache (level, dept, reg, data)
select 'eco', '', z.nom, public.occupation_fc(z.geom)
from public.zones_eco z
on conflict (level, dept, reg) do update
  set data = excluded.data, built_at = now();

-- 4) Vérif des tailles (une réponse de fonction Netlify est limitée à ~6 Mo,
--    donc toute zone dont le cache dépasse ~4-5 Mo ne génèrera pas de carte).
--   select reg, pg_size_pretty(length(data::text)::bigint)
--   from public.occupation_cache where level='eco' order by 2 desc;

-- ============================================================
--  5) ALLÈGEMENT DES GRANDES ZONES
--  Même approche que pour les vastes régions (Saint-Louis, Matam,
--  Tamba) : on reconstruit le cache avec une grille plus grossière, ce
--  qui « colle » les coordonnées à une grille (~0.0015° ≈ 165 m) et
--  réduit fortement le nombre de sommets, donc le poids du GeoJSON.
-- ============================================================

-- 5a) Surcharge avec pas de grille (versionnée ici pour être reproductible).
--     Identique à occupation_fc(geometry) mais : st_unaryunion sur une grille
--     paramétrable + ST_AsGeoJSON à 5 décimales (au lieu de 6).
--     On DROP d'abord : une version existante peut avoir un défaut sur p_grid,
--     que « create or replace » ne sait pas retirer (ERREUR 42P13).
drop function if exists public.occupation_fc(geometry, double precision);
create or replace function public.occupation_fc(p_zone geometry, p_grid double precision)
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
    select nom, st_unaryunion(st_collect(geom), p_grid) as geom
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

-- 5b) Allègement par SIMPLIFICATION DU CACHE EXISTANT (rapide).
--     Recalculer via occupation_fc re-découpe la couche subdivisée : trop
--     coûteux, l'éditeur SQL coupe la connexion. Ici on ne fait que réduire le
--     nombre de sommets du GeoJSON déjà calculé → quelques secondes par zone.
--     N'agit QUE sur level='eco' : les cartes commune ne sont pas touchées.
--     p_tol en degrés (0.002 ≈ 220 m). Renvoie la nouvelle taille.
create or replace function public.occupation_cache_simplify(
  p_reg text, p_tol double precision
) returns text language plpgsql as $$
declare
  v jsonb;
  out_features jsonb;
begin
  select data into v from public.occupation_cache
   where level = 'eco' and dept = '' and reg = p_reg;
  if v is null then return 'zone introuvable dans le cache'; end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'type', 'Feature',
             'properties', feat->'properties',
             'geometry', st_asgeojson(g, 5)::jsonb
           )
         ) filter (where g is not null and not st_isempty(g)), '[]'::jsonb)
    into out_features
  from (
    select feat,
           st_makevalid(
             st_simplifypreservetopology(
               st_geomfromgeojson(feat->>'geometry'), p_tol
             )
           ) as g
    from jsonb_array_elements(v->'features') as feat
  ) s;

  update public.occupation_cache
     set data = jsonb_build_object(
                  'type', 'FeatureCollection', 'features', out_features
                ),
         built_at = now()
   where level = 'eco' and dept = '' and reg = p_reg;

  return pg_size_pretty(length(
    jsonb_build_object('type','FeatureCollection','features',out_features)::text
  )::bigint);
end; $$;

--     Étape 1 — repérer les zones trop lourdes (> 4 Mo) :
--   select c.reg, pg_size_pretty(length(c.data::text)::bigint) as taille
--   from public.occupation_cache c
--   where c.level = 'eco' and length(c.data::text) > 4000000
--   order by length(c.data::text) desc;
--
--     Étape 2 — TOLÉRANCE CALIBRÉE sur l'échelle de sortie (~800 px de large) :
--     un demi-pixel au sol = (largeur de la zone en degrés) / 1600. En-dessous,
--     la simplification est invisible sur la carte exportée.
--   select nom,
--     round((greatest(st_xmax(geom)-st_xmin(geom),
--                     st_ymax(geom)-st_ymin(geom)) / 1600.0)::numeric, 5)
--       as tol_invisible
--   from public.zones_eco where nom = 'NOM_DE_LA_ZONE';
--
--     Étape 3 — applique cette tolérance (rapide) :
--   select public.occupation_cache_simplify('NOM_DE_LA_ZONE', 0.002);
--     Si la zone reste > ~6 Mo, monte un peu (0.003, 0.004) : tu restes
--     largement sous le pixel pour une zone de cette taille.

-- 5c) Re-vérif : il ne doit plus rester de zone > ~6 Mo.
--   select reg, pg_size_pretty(length(data::text)::bigint)
--   from public.occupation_cache where level='eco' order by 2 desc;
-- ============================================================
