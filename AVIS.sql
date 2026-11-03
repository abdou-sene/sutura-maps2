-- Avis clients « achat vérifié » : un avis par commande payée (token).
-- À jouer une fois dans Supabase (SQL Editor). Sans effet sur l'existant.
create table if not exists reviews (
  id bigint generated always as identity primary key,
  token text not null unique,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  name text,
  zone text,
  maptype text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reviews_approved_idx on reviews (approved, created_at desc);

-- Accès uniquement via les fonctions Netlify (clé service) : rien d'ouvert au public.
alter table reviews enable row level security;
