# SANDBOX SUBSTITUTE ONLY. Same version as supabase/gotrue:v2.197.0, built from the
# official GitHub release binary because Docker Hub is unreachable from the sandbox.
FROM tybc-spike/base:noble
COPY auth /usr/local/bin/auth
COPY migrations /usr/local/etc/auth/migrations
RUN ln -s /usr/local/bin/auth /usr/local/bin/gotrue
ENV GOTRUE_DB_MIGRATIONS_PATH=/usr/local/etc/auth/migrations
USER nobody
CMD ["auth"]
