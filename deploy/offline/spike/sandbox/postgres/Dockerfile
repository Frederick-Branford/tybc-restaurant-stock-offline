# SANDBOX SUBSTITUTE ONLY. PostgreSQL 17.11 built from the official REL_17_11 source tag,
# initialised with the Supabase init-scripts/migrations from supabase/postgres@17.11.0.003
# using the same docker-library entrypoint the upstream image uses. It does NOT contain
# Supabase's extra extensions except supautils 3.4.4 and safeupdate 1.4 (built from their tags) — no pgsodium, pg_graphql, vault, pg_net, pg_cron...).
FROM tybc-spike/base:noble
COPY pgsql /usr/local/pgsql
RUN groupadd -r postgres --gid=999 && useradd -r -g postgres --uid=999 --home-dir=/var/lib/postgresql --shell=/bin/bash postgres \
 && mkdir -p /var/lib/postgresql/data /var/run/postgresql /docker-entrypoint-initdb.d \
 && chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql && chmod 3777 /var/run/postgresql
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY supautils.conf /etc/postgresql-custom/supautils.conf
COPY postgresql.conf /etc/postgresql/postgresql.conf
RUN chown -R postgres:postgres /etc/postgresql /etc/postgresql-custom
COPY initdb/ /docker-entrypoint-initdb.d/
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh /docker-entrypoint-initdb.d/migrate.sh
ENV PATH=/usr/local/pgsql/bin:$PATH \
    PGDATA=/var/lib/postgresql/data \
    POSTGRES_HOST=/var/run/postgresql \
    POSTGRES_USER=supabase_admin \
    POSTGRES_DB=postgres \
    POSTGRES_INITDB_ARGS="--allow-group-access --locale-provider=icu --encoding=UTF-8 --icu-locale=en-US --locale=C.UTF-8" \
    LANG=C.UTF-8
STOPSIGNAL SIGINT
EXPOSE 5432
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres", "-D", "/etc/postgresql"]
