# Restaurer l'occupation du sol dans Supabase

## Diagnostic

- La fonction Netlify `get-occupation` et le front sont corrects.
- La table `occupation_du_sol` existe dans Supabase (colonnes `id, geom, OBJECTID, NOM`) mais elle est **vide**.
- La RPC `get_occupation_par_commune` référence une table `occupation_sol` (sans « du ») qui n'existe pas, d'où l'erreur `relation "occupation_sol" does not exist`.

Deux actions : charger les données dans la table, puis recréer la RPC avec le bon nom.

---

## Étape 0 — Récupérer la connexion Supabase

Dans Supabase : bouton **Connect** (en haut) → onglet **psql** ou **ORMs**. Tu y trouves :

- Host (du type `db.hbzxcdoscjdxklwjvmwv.supabase.co` ou un pooler `aws-0-...pooler.supabase.com`)
- Port (`5432` en session, ou `6543` en transaction)
- Database : `postgres`
- User : `postgres` (ou `postgres.hbzxcdoscjdxklwjvmwv` avec le pooler)
- Password : ton mot de passe de base (Project Settings → Database → Reset si oublié)

Pour un import en masse, prends la connexion **Session** (port 5432).

---

## Étape 1 — Vider la table existante

Dans Supabase → **SQL Editor**, lance :

```sql
drop table if exists public.occupation_du_sol cascade;
```

La table est vide, on ne perd rien. On la recrée proprement à l'import.

---

## Étape 2 — Charger les données

Le fichier source est `data/occupation_du_sol.geojson` (58 Mo) dans le projet. Deux méthodes, choisis-en une.

### Méthode A — QGIS (recommandée pour toi)

1. Dans QGIS, crée une connexion PostgreSQL/PostGIS vers Supabase
   (menu **Couche → Gestionnaire des sources de données → PostgreSQL → Nouveau**,
   et remplis Host / Port / Database / User / Password de l'étape 0,
   coche SSL = require).
2. Ajoute la couche `occupation_du_sol.geojson` dans QGIS.
3. Ouvre **Base de données → Gestionnaire de BD (DB Manager)**.
4. Sélectionne ta connexion Supabase, puis **Importer une couche/fichier**.
   - Table de sortie : `occupation_du_sol`
   - Schéma : `public`
   - Colonne géométrie : `geom`
   - SCR source et cible : **EPSG:4326**
   - Coche **Créer un index spatial** et **Clé primaire** (`id`)
5. Lance l'import. Vérifie ensuite que les colonnes `NOM` et `geom` sont bien là.

### Méthode B — ogr2ogr (ligne de commande, si GDAL installé)

```bash
ogr2ogr -f PostgreSQL \
  PG:"host=HOST port=5432 dbname=postgres user=USER password=MOTDEPASSE sslmode=require" \
  "data/occupation_du_sol.geojson" \
  -nln public.occupation_du_sol \
  -nlt MULTIPOLYGON \
  -lco GEOMETRY_NAME=geom \
  -lco FID=id \
  -lco LAUNDER=NO \
  -t_srs EPSG:4326
```

`-lco LAUNDER=NO` garde les noms `NOM` et `OBJECTID` en majuscules, comme dans la RPC ci-dessous.

---

## Étape 3 — Index spatiaux (performance)

Dans le SQL Editor :

```sql
create index if not exists idx_occupation_geom
  on public.occupation_du_sol using gist (geom);

create index if not exists idx_communes_geom
  on public.communes using gist (geom);
```

(Si l'import QGIS a déjà créé l'index sur `occupation_du_sol`, la première ligne ne fera rien, c'est normal.)

---

## Étape 4 — Recréer la RPC (le bon nom de table)

Dans le SQL Editor :

```sql
create or replace function public.get_occupation_par_commune(
  p_commune text,
  p_dept text,
  p_reg text
)
returns jsonb
language sql
stable
as $$
  with c as (
    select geom
    from public.communes
    where "CCRCA" = p_commune
      and "DEPT" = p_dept
      and "REG"  = p_reg
    limit 1
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'properties', jsonb_build_object('NOM', o."NOM"),
          'geometry', st_asgeojson(st_intersection(o.geom, c.geom))::jsonb
        )
      ),
      '[]'::jsonb
    )
  )
  from public.occupation_du_sol o, c
  where st_intersects(o.geom, c.geom)
    and not st_isempty(st_intersection(o.geom, c.geom));
$$;
```

Cette fonction prend la commune, récupère son polygone, découpe l'occupation du sol à l'intérieur de la commune, et renvoie un FeatureCollection avec la propriété `NOM` (exactement ce que le front attend).

---

## Étape 5 — Tester

Dans le SQL Editor, remplace par une vraie commune (en MAJUSCULES) :

```sql
select public.get_occupation_par_commune('BABA GARAGE', 'BAMBEY', 'DIOURBEL');
```

Tu dois voir un JSON `{"type":"FeatureCollection","features":[...]}` non vide.

Ensuite, sur le site : Créer une carte → Occupation du sol → région, département, commune → Suivant. Les classes doivent se charger.

---

## Note

Les RPC `get_occupation_par_dept` et `get_occupation_par_region` référencent aussi l'ancien nom et resteront cassées, mais l'app ne les appelle plus (occupation limitée à la commune). Pas besoin d'y toucher.
