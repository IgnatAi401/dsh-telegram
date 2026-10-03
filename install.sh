#!/usr/bin/env bash
# Install or remove the Telegram plugin through DSH's plugin manager
# (`dsh plugin --profile <name> add|remove`), which runs pnpm inside the
# profile directory and enables the bundle declared in package.json.
#
#   bash install.sh [install|uninstall] [profile]          # from a checkout
#   curl -fsSL .../install.sh | bash -s -- install [profile]
#
# DSH_TELEGRAM_DSH overrides the dsh command (default: npx -y @deepseek-ai/dsh).
set -euo pipefail

ACTION="${1:-install}"
PROFILE="${2:-${DSH_TELEGRAM_PROFILE:-web}}"
PACKAGE=dsh-telegram
REMOTE_SPEC=github:IgnatAy/dsh-telegram
if [ "$#" -gt 2 ] || { [ "$ACTION" != install ] && [ "$ACTION" != uninstall ]; }; then
  echo 'usage: bash install.sh [install|uninstall] [profile]' >&2
  exit 2
fi
if [[ ! "$PROFILE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [ "$PROFILE" = node_modules ]; then
  echo 'install: invalid profile name' >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1 \
  || ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 19 || major >= 24 ? 0 : 1)'; then
  echo 'install: Node.js 22.19+ or 24+ is required' >&2
  exit 1
fi
read -r -a DSH <<< "${DSH_TELEGRAM_DSH:-npx -y @deepseek-ai/dsh}"

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
# shellcheck disable=SC2088 # match a literal tilde supplied through the environment
case "$DSH_HOME" in
  '~') DSH_HOME="$HOME" ;;
  '~/'*) DSH_HOME="$HOME/${DSH_HOME#\~/}" ;;
esac
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"

# `dsh plugin` needs pnpm on PATH; borrow one through npx when it is missing.
if ! command -v pnpm >/dev/null 2>&1; then
  SHIM="$(mktemp -d)"
  trap 'rm -rf "$SHIM"' EXIT
  printf '#!/bin/sh\nexec npx -y pnpm@11 "$@"\n' > "$SHIM/pnpm"
  chmod +x "$SHIM/pnpm"
  PATH="$SHIM:$PATH"
fi

# Releases up to 0.2.x copied the plugin into the profile and inserted a
# marked row into its patch; remove both so the bundle row is the only one.
remove_copy_install() {
  local patch="$PROFILE_DIR/cordis.patch.yml"
  local begin='# telegram plugin begin (managed by scripts/install-copy.sh)'
  local end='# telegram plugin end (managed by scripts/install-copy.sh)'
  if [ -f "$patch" ] && grep -qF "$begin" "$patch"; then
    local cleaned
    cleaned="$(mktemp "$patch.XXXXXX")"
    awk -v begin="$begin" -v end="$end" '
      $0 == begin { skip = 1; next }
      skip && $0 == end { skip = 0; next }
      !skip { print }
    ' "$patch" > "$cleaned"
    grep -qE '^[[:space:]]*[^#[:space:]]' "$cleaned" || printf '[]\n' >> "$cleaned"
    mv "$cleaned" "$patch"
    echo "removed the old telegram row from $patch"
  fi
  if [ -d "$PROFILE_DIR/node_modules/$PACKAGE" ] && ! installed_by_pnpm; then
    rm -rf "$PROFILE_DIR/node_modules/$PACKAGE"
    echo "removed the old copied plugin from $PROFILE_DIR/node_modules"
  fi
}

installed_by_pnpm() {
  [ -f "$PROFILE_DIR/package.json" ] && node -e '
    const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
    process.exit(Object.hasOwn(manifest.dependencies ?? {}, process.argv[2]) ? 0 : 1)
  ' "$PROFILE_DIR/package.json" "$PACKAGE"
}

remove_copy_install
if [ "$ACTION" = uninstall ]; then
  if installed_by_pnpm; then
    "${DSH[@]}" plugin --profile "$PROFILE" remove "$PACKAGE"
  else
    echo "note: $PACKAGE is not installed in profile $PROFILE"
  fi
  echo "uninstalled; restart DSH to apply"
  exit 0
fi

# A checkout installs itself (including uncommitted builds); a piped run installs the GitHub main branch.
ROOT=''
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/package.json" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$ROOT" ] && [ -f "$ROOT/lib/index.js" ]; then
  SPEC="file:$ROOT"
else
  SPEC="$REMOTE_SPEC"
fi
"${DSH[@]}" plugin --profile "$PROFILE" add "$SPEC"
cat <<EOF

installed $PACKAGE into profile $PROFILE. Start DSH with:
  export DSH_TELEGRAM_TOKEN='<bot token>'
  export DSH_TELEGRAM_ALLOWED_USER_IDS='<your numeric Telegram user id>'
  npx @deepseek-ai/dsh --profile $PROFILE
EOF
