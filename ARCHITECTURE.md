# Sutura Maps — Architecture technique

Document de référence pour comprendre, maintenir et faire évoluer Sutura Maps.
Écrit pour être lu sans être développeur pointu.

---

## 1. Vue d'ensemble

Sutura Maps génère des cartes (localisation, occupation du sol, relief/MNT) des
communes, départements et régions du Sénégal et d'Afrique de l'Ouest. Le client
voit sa carte gratuitement, puis paie 2 000 FCFA pour la télécharger en HD.

Il n'y a **pas de serveur classique qui tourne en permanence.** L'architecture
repose sur du **statique + serverless + base de données managée**. C'est simple
et peu coûteux, mais ça impose des limites (temps d'exécution, mémoire) qui
expliquent pourquoi certains calculs sont sur le navigateur du client.

```
   [ Navigateur du client ]  ← FRONT : interface + une grande part des calculs
        │        │
        │        └──→ [ AWS Terrain Tiles ]  tuiles d'altitude mondiales (MNT)
        │
        ▼
   [ Netlify ]
     ├─ sert les fichiers statiques (HTML / CSS / JS / data GeoJSON)
     └─ Netlify Functions (Node, serverless) = le « backend »
            │
            ├──→ [ Supabase ]  Postgres + PostGIS
            │        ├─ exports            (les commandes)
            │        ├─ occupation_cache   (résultats d'occupation pré-calculés)
            │        ├─ occupation_sol_sub (couche d'occupation subdivisée)
            │        ├─ communes / departements / regions
            │        └─ RPC PostGIS (get_occupation_par_*, occupation_fc)
            │
            └──→ [ Bictorys ]  paiement mobile money (Wave / Orange / MaxIt)
```

---

## 2. Stack technologique

| Couche | Technologie | Rôle |
|---|---|---|
| Front | HTML / CSS / **JavaScript pur** (aucun framework) | Interface et logique client |
| Cartes | **Leaflet** | Affichage cartographique |
| Calculs géo (front) | **Turf.js** | Fusion de contours, limitrophes, intersections |
| Export image | **dom-to-image** | Transforme la carte HTML en PNG |
| Landing | **Tailwind CDN** + **FontAwesome** | Style de la page d'accueil uniquement |
| Hébergement | **Netlify** | Sert le statique + héberge les fonctions |
| Backend | **Netlify Functions** (Node, serverless) | Paiement, lecture données, admin, tracking |
| Base de données | **Supabase** = PostgreSQL + **PostGIS** | Commandes, données spatiales, cache |
| Paiement | **Bictorys** | Encaissement + webhook de confirmation |
| Altitude | **AWS Terrain Tiles** (encodage Terrarium) | Données d'élévation mondiales pour le MNT |

Seule dépendance npm des fonctions : `@supabase/supabase-js`.

---

## 3. Structure des fichiers (les plus importants)

```
/
├─ index.html            Landing (marketing, Tailwind)
├─ map.html              L'application (générateur de cartes)
├─ commande.html         Commande de carte sur mesure (offre à part)
├─ admin.html            Tableau de bord admin
├─ style.css             Styles de l'app (map.html)
├─ script.js             ⭐ Le cœur : toute la logique de génération de cartes
├─ pwa.js / pwa.css      Installation en app (PWA)
├─ manifest.json         Manifeste PWA
├─ robots.txt / sitemap.xml   SEO
│
├─ data/                 Données géographiques statiques (servies au front)
│   ├─ meta.json         Noms commune/dept/région (remplit les menus)
│   ├─ communes.geojson  Géométries des communes du Sénégal
│   ├─ departements.geojson / regions.geojson
│   ├─ localites.geojson / routes.geojson / cours_eau.geojson / ocean.geojson
│   ├─ BEN/  CIV/         Données GADM par pays (adm1/2/3…)
│
├─ netlify/functions/    Le « backend » serverless
│   ├─ create-payment.js  Crée une commande + lance le paiement Bictorys
│   ├─ check-token.js     Vérifie si une commande est payée (téléchargement)
│   ├─ bictorys-webhook.js  Reçoit la confirmation de paiement de Bictorys
│   ├─ get-occupation.js  Renvoie l'occupation du sol (appelle Supabase)
│   ├─ admin-stats.js     Statistiques du dashboard
│   ├─ admin-actions.js   Actions admin (rembourser, marquer payé…)
│   ├─ track.js           Compteur de visites / générations / paiements
│   └─ netlify.toml       Config des fonctions
│
└─ *.sql                 Scripts à exécuter dans Supabase (migrations)
    ├─ RPC-OCCUPATION-DEPT-REGION.sql  Fonctions + cache d'occupation
    ├─ EXPORTS-PALIERS.sql             Colonnes maptype/level/amount
    ├─ GARANTIE-REMBOURSEMENT.sql      Colonne refunded_at
    └─ COUNTRIES-EXPORTS.sql           Colonnes country/gid (multi-pays)
```

⭐ **`script.js` est le fichier central.** Toute la génération de cartes vit là :
sélection de zone, appels serveur, rendu Leaflet, calcul du relief, export PNG,
tunnel de paiement côté client.

---

## 4. Les fonctions Netlify (le « backend »), une par une

| Fonction | Déclenchée par | Ce qu'elle fait |
|---|---|---|
| `create-payment` | Clic « télécharger » | Calcule le prix **côté serveur** (2 000 FCFA), crée la ligne dans `exports`, demande une URL de paiement à Bictorys |
| `bictorys-webhook` | Bictorys (après paiement) | Vérifie la signature, passe la commande à `paid = true` |
| `check-token` | Le front (après retour de paiement) | Dit si la commande est payée, renvoie les infos pour reconstruire la carte |
| `get-occupation` | Génération d'une carte d'occupation | Appelle la RPC Supabase, renvoie le GeoJSON d'occupation |
| `admin-stats` | `admin.html` | Agrège visites / générations / paiements / revenus |
| `admin-actions` | `admin.html` | Rembourser, prolonger, marquer payé/non payé, supprimer (protégé par mot de passe) |
| `track` | Le front | Incrémente les compteurs (visit / generation / payment_init) |

Règle de sécurité clé : **le prix est toujours calculé côté serveur**, jamais
reçu du navigateur. Le client ne peut pas se fabriquer un prix.

---

## 5. La base Supabase

**Tables principales**
- `exports` : une ligne par commande (token, zone, type, niveau, montant, payé,
  `paid_at`, `refunded_at`, `country`, `gid`…).
- `occupation_cache` : résultats d'occupation du sol **pré-calculés** (par
  niveau : commune / dept / région), pour ne pas recalculer à chaque visite.
- `occupation_sol_sub` : la couche d'occupation découpée en petits morceaux
  indexés (pour un découpage rapide).
- `communes` / `departements` / `regions` : géométries administratives.

**Fonctions RPC (PostGIS)**
- `get_occupation_par_commune` / `_par_dept` / `_par_region` : lisent le cache,
  sinon calculent à la volée.
- `occupation_fc(geometry)` : le moteur de découpe (clip + dissolution). C'est
  la fonction qui a causé des soucis quand elle a été supprimée par erreur.

---

## 6. Variables d'environnement (dans Netlify)

| Variable | Rôle |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Clé service (accès complet, côté serveur uniquement) |
| `BICTORYS_API_KEY` | Clé API paiement |
| `BICTORYS_WEBHOOK_SECRET` | Secret pour vérifier les webhooks |
| `APP_URL` | URL publique du site (redirections de paiement) |
| `ADMIN_PASSWORD` | Mot de passe du dashboard admin |

Ces valeurs ne sont **jamais** dans le code : elles vivent dans les réglages
Netlify. Ne jamais les committer.

---

## 7. Où se font les calculs (le point important)

| Traitement | Où ça tourne | Pourquoi |
|---|---|---|
| **Occupation du sol** (découpe/dissolution) | **Backend** (Supabase PostGIS + cache) | Trop lourd pour le navigateur |
| **Relief / MNT** (tuiles, pixels, classification) | **Front (navigateur)** | Gratuit : c'est l'appareil du client qui bosse |
| **Localisation** (fusion contours, limitrophes) | **Front (Turf.js)** | Rapide sur des géométries légères |
| Rendu de carte, export PNG | **Front** (Leaflet + dom-to-image) | Normal |
| Paiement, prix, commandes | **Backend** | Sécurité et fiabilité |

Résumé : **le relief et la localisation calculent sur le téléphone/PC du
client.** L'occupation est déjà côté serveur.

---

## 8. Deux flux à connaître

**A. Générer une carte**
1. Le front charge les menus depuis `data/meta.json` (ou les fichiers du pays).
2. L'utilisateur choisit pays / zone / type de carte.
3. Selon le type : localisation et relief se calculent **sur le front** ;
   l'occupation appelle `get-occupation` → Supabase.
4. Leaflet dessine, l'utilisateur voit sa carte gratuitement (avec filigrane).

**B. Payer et télécharger**
1. Clic « télécharger » → `create-payment` crée la commande + URL Bictorys.
2. L'utilisateur paie sur Bictorys (mobile money).
3. `bictorys-webhook` confirme → `exports.paid = true`.
4. Le front interroge `check-token`, puis **régénère la carte** et exporte le PNG
   HD sans filigrane (téléchargeable 1 h).

---

## 9. Feuille de route « basculer les calculs en backend »

Objectif possible : que le client reçoive une image déjà prête, sans que son
appareil calcule (fini les plantages sur vieux téléphone).

Ordre recommandé, du plus simple au plus lourd :

1. **Pré-calcul + cache (déjà fait pour l'occupation).** Le modèle qui marche :
   calculer une fois, stocker dans Supabase, servir le cache. À étendre.
2. **Relief (MNT) — le plus gros chantier.** Aujourd'hui 100 % front. Options :
   - **a)** Une Netlify Function qui fait le calcul du relief et renvoie un PNG.
     Limite : temps d'exécution (~10-26 s) et mémoire → risqué sur grandes zones.
   - **b)** Un **vrai petit service** (un serveur Node/Python dédié, ou un service
     de rendu raster) déclenché par une fonction. Plus robuste, mais c'est une
     nouvelle brique à héberger et payer.
   - **c)** **Pré-générer** les reliefs des zones populaires et les mettre en
     cache (comme l'occupation). Compromis simple et efficace.
3. **Localisation.** Moins urgent (léger). Peut rester sur le front longtemps.

Compromis clé : le front gratuit vs un backend qui coûte (compute + hébergement).
Tant que le trafic est modéré, le front reste le choix économique ; le
basculement devient pertinent quand le volume et les exigences de fiabilité
montent.

---

## 10. Pour maintenir sereinement

- **Ne rien casser** : chaque nouveauté doit préserver les cartes existantes.
- **Tester en local** avec `netlify dev` avant de pousser.
- **Migrations SQL** : les fichiers `*.sql` se lancent à la main dans Supabase,
  dans l'ordre logique. Les garder versionnés.
- **Supabase est en plan gratuit (Nano)** : petites ressources. Éviter les gros
  recalculs en rafale (ils saturent la base). Préférer pré-calcul + cache.
- **Le prix et la sécurité restent côté serveur.** Ne jamais faire confiance au
  navigateur pour un montant.
