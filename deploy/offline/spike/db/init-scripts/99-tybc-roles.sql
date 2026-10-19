-- TYBC offline bootstrap (local only, first initialisation of an EMPTY volume).
-- Runs from /docker-entrypoint-initdb.d/init-scripts/ via the image's migrate.sh as
-- role postgres, after Supabase's own init scripts. Values come from the container
-- environment and are never printed. Not a repository migration; never run on Cloud.
\set ON_ERROR_STOP on
\set authenticator_pass `printf '%s' "$AUTHENTICATOR_PASSWORD"`
\set auth_admin_pass `printf '%s' "$SUPABASE_AUTH_ADMIN_PASSWORD"`
\set backup_pass `printf '%s' "$TYBC_BACKUP_PASSWORD"`

alter user authenticator with password :'authenticator_pass';
alter user supabase_auth_admin with password :'auth_admin_pass';

-- Read-only backup role (pg_dump needs BYPASSRLS to read RLS-protected tables).
create role tybc_backup with login bypassrls password :'backup_pass';
grant pg_read_all_data to tybc_backup;
