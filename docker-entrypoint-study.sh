#!/bin/sh
set -eu

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

SUPABASE_URL_ESCAPED="$(escape_js_string "${SUPABASE_URL:-}")"
SUPABASE_PUBLISHABLE_KEY_ESCAPED="$(escape_js_string "${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}")"
APP_URL_ESCAPED="$(escape_js_string "${APP_URL:-}")"

cat > /usr/share/nginx/html/config.js <<CONFIG
window.STUDYLIBRARY_CONFIG = {
  SUPABASE_URL: "${SUPABASE_URL_ESCAPED}",
  SUPABASE_PUBLISHABLE_KEY: "${SUPABASE_PUBLISHABLE_KEY_ESCAPED}",
  APP_URL: "${APP_URL_ESCAPED}"
};
CONFIG


escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

API_SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:9}"
API_SUPABASE_KEY="${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}"
API_SUPABASE_URL_ESCAPED="$(escape_sed_replacement "$API_SUPABASE_URL")"
API_SUPABASE_KEY_ESCAPED="$(escape_sed_replacement "$API_SUPABASE_KEY")"

sed -i \
  -e "s|__SUPABASE_URL__|${API_SUPABASE_URL_ESCAPED}|g" \
  -e "s|__SUPABASE_PUBLISHABLE_KEY__|${API_SUPABASE_KEY_ESCAPED}|g" \
  /etc/nginx/conf.d/default.conf
