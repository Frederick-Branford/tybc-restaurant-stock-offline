#!/bin/sh
# Mimics the official nginx image template step: render /etc/nginx/templates/*.template
# into /etc/nginx/conf.d/, substituting only ${UPPER_CASE} variables defined in the environment.
set -eu
mkdir -p /etc/nginx/conf.d
for t in /etc/nginx/templates/*.template; do
  [ -e "$t" ] || continue
  perl -pe 's/\$\{([A-Z_][A-Z0-9_]*)\}/exists $ENV{$1} ? $ENV{$1} : $&/ge' "$t" > "/etc/nginx/conf.d/$(basename "$t" .template)"
done
exec "$@"
