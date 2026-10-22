#!/usr/bin/env bash
# Install or remove the Telegram plugin through DSH's plugin manager
# (`dsh plugin --profile <name> add|remove`), which runs pnpm inside the
# profile directory and enables the bundle declared in package.json.
#
#   bash install.sh [install|uninstall] [profile]          # from a checkout
#   curl -fsSL .../install.sh | bash -s -- install [profile]
#
# The `desktop` profile belongs to DeepSeek Harness Desktop and is managed with
# the dsh command bundled in the app, which carries its own Node.js and pnpm.
# Other profiles use `npx -y @deepseek-ai/dsh`. DSH_TELEGRAM_DSH overrides the
# dsh command for either.
set -euo pipefail

ACTION="${1:-install}"
PROFILE="${2:-${DSH_TELEGRAM_PROFILE:-web}}"
PACKAGE=dsh-telegram
REMOTE_SPEC=github:IgnatAi401/dsh-telegram
if [ "$#" -gt 2 ] || { [ "$ACTION" != install ] && [ "$ACTION" != uninstall ]; }; then
  echo 'usage: bash install.sh [install|uninstall] [profile]' >&2
  exit 2
fi
if [[ ! "$PROFILE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [ "$PROFILE" = node_modules ]; then
  echo 'install: invalid profile name' >&2
  exit 2
fi

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
# shellcheck disable=SC2088 # match a literal tilde supplied through the environment
case "$DSH_HOME" in
  '~') DSH_HOME="$HOME" ;;
  '~/'*) DSH_HOME="$HOME/${DSH_HOME#\~/}" ;;
esac
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"

# Desktop's bundled command on macOS; otherwise the `dsh` registered on PATH
# through the app menu (Manage dsh command…).
desktop_dsh() {
  local app
  for app in "/Applications/DeepSeek Harness.app" "$HOME/Applications/DeepSeek Harness.app"; do
    if [ -x "$app/Contents/Resources/runtime/cli/bin/dsh" ]; then
      printf '%s\n' "$app/Contents/Resources/runtime/cli/bin/dsh"
      return
    fi
  done
  command -v dsh 2>/dev/null || true
}

if [ "$PROFILE" = desktop ]; then
  # Desktop must be fully quit before its profile's packages change.
  if pgrep -x 'DeepSeek Harness' >/dev/null 2>&1; then
    echo 'install: quit DeepSeek Harness Desktop completely first, then re-run' >&2
    exit 1
  fi
  if [ -n "${DSH_TELEGRAM_DSH:-}" ]; then
    read -r -a DSH <<< "$DSH_TELEGRAM_DSH"
  else
    DSH=("$(desktop_dsh)")
    if [ -z "${DSH[0]}" ]; then
      echo 'install: the dsh command of DeepSeek Harness Desktop was not found; register it from the app menu (Manage dsh command…)' >&2
      exit 1
    fi
  fi
else
  if ! command -v node >/dev/null 2>&1 \
    || ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 19 || major >= 24 ? 0 : 1)'; then
    echo 'install: Node.js 22.19+ or 24+ is required' >&2
    exit 1
  fi
  read -r -a DSH <<< "${DSH_TELEGRAM_DSH:-npx -y @deepseek-ai/dsh}"
  # `dsh plugin` needs pnpm on PATH; borrow one through npx when it is missing.
  if ! command -v pnpm >/dev/null 2>&1; then
    SHIM="$(mktemp -d)"
    trap 'rm -rf "$SHIM"' EXIT
    printf '#!/bin/sh\nexec npx -y pnpm@11 "$@"\n' > "$SHIM/pnpm"
    chmod +x "$SHIM/pnpm"
    PATH="$SHIM:$PATH"
  fi
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

# Only `dependencies` uses the package name as a key; the bundle list holds it as a value.
installed_by_pnpm() {
  [ -f "$PROFILE_DIR/package.json" ] && grep -qE "\"$PACKAGE\"[[:space:]]*:" "$PROFILE_DIR/package.json"
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
# pnpm keeps the commit a git spec resolved to in the lockfile, so re-adding the same
# spec reports "Already up to date"; `update` re-resolves it to the branch tip.
if [ "$SPEC" = "$REMOTE_SPEC" ] && [ -f "$PROFILE_DIR/package.json" ] \
  && grep -qE "\"$PACKAGE\"[[:space:]]*:[[:space:]]*\"$REMOTE_SPEC\"" "$PROFILE_DIR/package.json"; then
  "${DSH[@]}" plugin --profile "$PROFILE" update "$PACKAGE"
else
  "${DSH[@]}" plugin --profile "$PROFILE" add "$SPEC"
fi
if [ "$PROFILE" = desktop ]; then
  START='reopen DeepSeek Harness Desktop'
else
  START="start DSH with: npx @deepseek-ai/dsh --profile $PROFILE"
fi
cat <<EOF

installed $PACKAGE into profile $PROFILE. Put the bot settings in $DSH_HOME/.env:
  TELEGRAM_BOT_TOKEN=<bot token>
  TELEGRAM_ALLOWED_USER_IDS=<your numeric Telegram user id>
then $START.
EOF
