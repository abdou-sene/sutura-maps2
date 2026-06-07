-- Colonnes pour enregistrer ce qui a été payé (type, niveau, montant).
-- À coller une fois dans Supabase.
alter table public.exports
  add column if not exists maptype text,
  add column if not exists level   text,
  add column if not exists amount  integer;
