-- ============================================================
--  Multi-pays : colonnes pour identifier une commande hors Sénégal.
--  - country : code ISO du pays (SN par défaut).
--  - gid     : code GADM de la zone (unique, ex. "CIV.1.1.1_1").
--  À coller dans Supabase (léger, additif, sans impact sur l'existant).
-- ============================================================
alter table public.exports add column if not exists country text;
alter table public.exports add column if not exists gid text;

-- Les commandes existantes sont sénégalaises par défaut.
update public.exports set country = 'SN' where country is null;
