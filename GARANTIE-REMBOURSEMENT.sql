-- Garantie satisfait ou remboursé : traçage des remboursements.
-- À coller une fois dans Supabase.
alter table public.exports
  add column if not exists refunded_at timestamptz;
