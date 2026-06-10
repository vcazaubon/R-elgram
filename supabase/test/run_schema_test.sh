#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$HERE/../migrations/0001_init.sql"
MIGRATION4="$HERE/../migrations/0004_media_carousel.sql"
sudo pg_virtualenv bash -c "
  psql -v ON_ERROR_STOP=1 -v migration='$MIGRATION' -v migration4='$MIGRATION4' -f '$HERE/schema_test.sql'
"
