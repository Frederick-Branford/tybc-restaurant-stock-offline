#!/bin/sh
# TYBC migrate runner (spike). Applies supabase/migrations/*.sql in lexical order as
# role postgres (the role the Supabase CLI uses), one transaction per file, and records
# each version in supabase_migrations.schema_migrations (CLI-compatible table).
# Refuses to run if the database records a version the bundle does not contain.
set -eu
export PGPASSWORD="${POSTGRES_PASSWORD:?}"
DIR="${MIGRATIONS_DIR:-/migrations}"
PSQL="psql -X -v ON_ERROR_STOP=1 -q"

# Preflight: the image's init can fail without stopping the container (the db still
# turns healthy), so verify the Supabase bootstrap before touching anything.
missing=$($PSQL -At <<'SQL'
select string_agg(r, ',') from unnest(array['anon','authenticated','service_role','authenticator',
  'supabase_auth_admin','supabase_admin','tybc_backup']) r
where not exists (select 1 from pg_roles where rolname = r);
SQL
)
auth_ok=$($PSQL -At -c "select count(*) from information_schema.tables where table_schema='auth' and table_name in ('users','identities','sessions','schema_migrations')")
if [ -n "$missing" ] || [ "$auth_ok" != "4" ]; then
  echo "REFUSED: database bootstrap incomplete (missing roles: ${missing:-none}; auth tables found: $auth_ok/4)"
  exit 4
fi

$PSQL <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
SQL

bundle=$(for f in "$DIR"/*.sql; do b=$(basename "$f"); echo "${b%%_*}"; done | sort)
recorded=$($PSQL -At -c "select version from supabase_migrations.schema_migrations order by 1")
for v in $recorded; do
  echo "$bundle" | grep -qx "$v" || { echo "REFUSED: database records unknown migration $v"; exit 3; }
done

applied=0
for f in $(ls "$DIR"/*.sql | sort); do
  b=$(basename "$f" .sql); v="${b%%_*}"; n="${b#*_}"
  if echo "$recorded" | grep -qx "$v"; then echo "skip   $v $n"; continue; fi
  echo "apply  $v $n"
  $PSQL -v v="$v" -v n="$n" <<SQL
begin;
\i $f
insert into supabase_migrations.schema_migrations (version, name) values (:'v', :'n');
commit;
SQL
  applied=$((applied + 1))
done
echo "migrations applied: $applied"
