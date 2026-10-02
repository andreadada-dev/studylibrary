#!/bin/sh
set -eu

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

SUPABASE_URL_ESCAPED="$(escape_js_string "${SUPABASE_URL:-}")"
SUPABASE_ANON_KEY_ESCAPED="$(escape_js_string "${SUPABASE_ANON_KEY:-}")"
APP_URL_ESCAPED="$(escape_js_string "${APP_URL:-}")"

cat > /usr/share/nginx/html/config.js <<CONFIG
window.STUDYLIBRARY_CONFIG = {
  SUPABASE_URL: "${SUPABASE_URL_ESCAPED}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY_ESCAPED}",
  APP_URL: "${APP_URL_ESCAPED}"
};
CONFIG
