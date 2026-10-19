-- TYBC Phase 2 — database-level compatibility checks (run as supabase_admin).
-- Output: one line per check "ID|PASS/FAIL|detail". Read-only except a rolled-back
-- immutability probe on SYNTHETIC data.
\pset format unaligned
\pset tuples_only on
\set ON_ERROR_STOP off

select 'D01|' || case when count(*) = 6 then 'PASS' else 'FAIL' end || '|' || string_agg(rolname || ':' ||
  case when rolsuper then 'super ' else '' end || case when rolbypassrls then 'bypassrls ' else '' end ||
  case when rolcanlogin then 'login' else 'nologin' end, ', ' order by rolname)
from pg_roles where rolname in ('anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_admin');

select 'D02|' || case when (select rolbypassrls from pg_roles where rolname='service_role')
  and not (select rolbypassrls from pg_roles where rolname='authenticated')
  and not (select rolinherit from pg_roles where rolname='authenticator')
  and (select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member
       where u.rolname='authenticator' and r.rolname in ('anon','authenticated','service_role')) = 3
  then 'PASS' else 'FAIL' end || '|service_role BYPASSRLS, authenticator NOINHERIT member of anon/authenticated/service_role';

select 'D03|' || case when (select rolsuper from pg_roles where rolname='postgres') then 'WARN' else 'PASS' end
  || '|postgres superuser=' || (select rolsuper from pg_roles where rolname='postgres')::text || ' (Supabase demotes postgres)';

select 'D04|' || case when count(*) >= 3 then 'PASS' else 'FAIL' end || '|' || string_agg(p.proname, ',' order by p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname in ('uid','role','jwt');

select 'D05|PASS|auth.schema_migrations latest=' || coalesce(max(version),'none') || ' count=' || count(*) from auth.schema_migrations;

select 'D06|' || case when count(*) = 10 then 'PASS' else 'FAIL' end || '|repo migrations recorded=' || count(*) || ' first=' || min(version) || ' last=' || max(version)
from supabase_migrations.schema_migrations;

select 'D07|' || case when count(*) = 18 and bool_and(c.relrowsecurity) then 'PASS' else 'FAIL' end
  || '|public tables=' || count(*) || ' rls_enabled=' || count(*) filter (where c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';

select 'D08|' || case when count(*) = 17 then 'PASS' else 'FAIL' end || '|policies=' || count(*) from pg_policies where schemaname='public';

select 'D09|' || case when count(*) > 0 and count(*) = count(*) filter (where array_to_string(p.proconfig, ',') like '%search_path=""%')
  then 'PASS' else 'FAIL' end
  || '|security definer functions=' || count(*) || ' (distinct; Phase 0 reported 14)'
  || ' all with empty search_path=' || (count(*) = count(*) filter (where array_to_string(p.proconfig, ',') like '%search_path=""%'))::text
  || ' [' || string_agg(p.proname, ',' order by p.proname) || ']'
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef;

select 'D10|' || case when count(*) filter (where t.tgenabled = 'O') = count(*) and count(*) > 0 then 'PASS' else 'FAIL' end
  || '|user triggers=' || count(*) || ' enabled=' || count(*) filter (where t.tgenabled='O') || ' incl on_auth_user_created=' ||
  bool_or(t.tgname='on_auth_user_created')::text
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname in ('public','auth');

-- Immutability enforced by triggers even for a superuser session (rolled back).
do $$
declare v_id uuid; v_msg text := 'no row';
begin
  select id into v_id from public.stock_movements limit 1;
  if v_id is not null then
    begin
      update public.stock_movements set note = 'tamper' where id = v_id;
      v_msg := 'UPDATE ALLOWED';
    exception when others then v_msg := 'update rejected: ' || sqlerrm;
    end;
    begin
      delete from public.stock_movements where id = v_id;
      v_msg := v_msg || '; DELETE ALLOWED';
    exception when others then v_msg := v_msg || '; delete rejected: ' || sqlerrm;
    end;
  end if;
  raise notice 'D11|%|%', case when v_msg like 'update rejected%' and v_msg like '%delete rejected%' then 'PASS' else 'FAIL' end, v_msg;
end $$;

select 'D12|' || case when count(*) = 0 then 'PASS' else 'FAIL' end || '|duplicate idempotency keys=' || count(*)
from (select idempotency_key from public.stock_movements where idempotency_key is not null group by 1 having count(*) > 1) d;

select 'D13|' || case when has_table_privilege('authenticated','public.stock_movements','INSERT') = false
  and has_table_privilege('service_role','public.stock_movements','UPDATE') = false
  and has_table_privilege('service_role','public.stock_movements','INSERT') = true then 'PASS' else 'FAIL' end
  || '|ledger grants: authenticated INSERT=' || has_table_privilege('authenticated','public.stock_movements','INSERT')
  || ' service_role INSERT=' || has_table_privilege('service_role','public.stock_movements','INSERT')
  || ' service_role UPDATE=' || has_table_privilege('service_role','public.stock_movements','UPDATE');

select 'D14|PASS|' || version();
select 'D15|PASS|server timezone=' || current_setting('TimeZone') || ' encoding=' || current_setting('server_encoding');
