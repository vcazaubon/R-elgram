#!/bin/sh
set -e
cat > /usr/share/nginx/html/env.js <<EOF
window.__ENV__ = {
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}",
  API_URL: "${API_URL:-/api}",
  ALLOW_SIGNUPS: "${ALLOW_SIGNUPS:-true}"
};
EOF
