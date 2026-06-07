-- Alléger les 3 régions vastes (occupation_fc et occupation_sol_sub existent déjà)
set statement_timeout = '900s';

insert into public.occupation_cache (level, dept, reg, data)
select 'region', '', r."REG", public.occupation_fc(r.geom, 0.0015)
from public.regions r
where r."REG" in ('SAINT-LOUIS', 'MATAM', 'TAMBACOUNDA')
on conflict (level, dept, reg) do update
  set data = excluded.data, built_at = now();

-- Vérif tailles :
select reg, pg_size_pretty(length(data::text)::bigint)
from public.occupation_cache where level = 'region' order by 2 desc;
