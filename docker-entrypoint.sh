#!/bin/sh
# This script must keep LF line endings because it runs inside Linux containers.
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R app:app /app/data
  exec runuser -u app -- "$@"
fi

exec "$@"
