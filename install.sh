#!/usr/bin/env bash
# Install, update or remove the Telegram plugin through DSH's plugin manager
# (`dsh plugin --profile <name> add|update|remove`), which runs pnpm inside the
# profile directory and enables the bundle declared in package.json.
#
#   curl -fsSL .../install.sh | bash                    # install or update
#   curl -fsSL .../install.sh | bash -s -- uninstall
#   bash install.sh [install|uninstall] [profile]       # from a checkout
#
# Without a profile the script finds every DSH on this machine: DeepSeek
# Harness Desktop (the `desktop` profile, managed with the dsh command bundled
# in the app, which carries its own Node.js and pnpm) and the command-line
# version (the `web` profile, managed with `npx -y @deepseek-ai/dsh`).
# DSH_TELEGRAM_DSH overrides the dsh command for every profile.
set -euo pipefail

ACTION="${1:-install}"
REQUESTED="${2:-${DSH_TELEGRAM_PROFILE:-}}"
PACKAGE=dsh-telegram
REMOTE_SPEC=github:IgnatAi401/dsh-telegram
DESKTOP_APP='DeepSeek Harness'
if [ "$#" -gt 2 ] || { [ "$ACTION" != install ] && [ "$ACTION" != uninstall ]; }; then
  echo 'usage: bash install.sh [install|uninstall] [profile]' >&2
  exit 2
fi
if [ -n "$REQUESTED" ] && { [[ ! "$REQUESTED" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [ "$REQUESTED" = node_modules ]; }; then
  echo 'install: invalid profile name' >&2
  exit 2
fi

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
# shellcheck disable=SC2088 # match a literal tilde supplied through the environment
case "$DSH_HOME" in
  '~') DSH_HOME="$HOME" ;;
  '~/'*) DSH_HOME="$HOME/${DSH_HOME#\~/}" ;;
esac

# Desktop's bundled command on macOS; otherwise the `dsh` registered on PATH
# through the app menu (Manage dsh command…).
# DSH_TELEGRAM_APP_DIRS (colon-separated) replaces the folders searched for the app.
app_dsh() {
  local dirs dir
  IFS=: read -r -a dirs <<< "${DSH_TELEGRAM_APP_DIRS:-/Applications:$HOME/Applications}"
  for dir in "${dirs[@]}"; do
    if [ -x "$dir/$DESKTOP_APP.app/Contents/Resources/runtime/cli/bin/dsh" ]; then
      printf '%s\n' "$dir/$DESKTOP_APP.app/Contents/Resources/runtime/cli/bin/dsh"
      return
    fi
  done
}
desktop_dsh() {
  local found
  found="$(app_dsh)"
  if [ -n "$found" ]; then printf '%s\n' "$found"; else command -v dsh 2>/dev/null || true; fi
}

node_ok() {
  command -v node >/dev/null 2>&1 \
    && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 22 && minor >= 19 || major >= 24 ? 0 : 1)'
}

desktop_running() { pgrep -x "$DESKTOP_APP" >/dev/null 2>&1; }

# Profiles to manage: the one named, or every DSH found on this machine.
PROFILES=()
if [ -n "$REQUESTED" ]; then
  PROFILES=("$REQUESTED")
else
  HAS_DESKTOP=''
  if [ -n "$(app_dsh)" ] || { [ -d "$DSH_HOME/profiles/desktop" ] && [ -n "${DSH_TELEGRAM_DSH:-$(desktop_dsh)}" ]; }; then
    HAS_DESKTOP=1
  fi
  [ -n "$HAS_DESKTOP" ] && PROFILES+=(desktop)
  if [ -d "$DSH_HOME/profiles/web" ] || { [ -z "$HAS_DESKTOP" ] && node_ok; }; then
    PROFILES+=(web)
  fi
  if [ "${#PROFILES[@]}" -eq 0 ]; then
    cat >&2 <<'EOF'
install: no DeepSeek Harness found.
  Desktop: install the app, then register its command from the app menu (Manage dsh command…).
  Command line: install Node.js 22.19+ or 24+ (npx @deepseek-ai/dsh).
EOF
    exit 1
  fi
fi

# Desktop must be fully quit before its profile's packages change. On macOS
# the script asks the app to quit and reopens it afterwards.
REOPEN_DESKTOP=''
quit_desktop() {
  desktop_running || return 0
  if [ "$(uname -s)" = Darwin ] && command -v osascript >/dev/null 2>&1; then
    echo "quitting $DESKTOP_APP; it reopens when the plugin is in place"
    osascript -e "quit app \"$DESKTOP_APP\"" >/dev/null 2>&1 || true
    local waited=0
    while desktop_running && [ "$waited" -lt 30 ]; do sleep 1; waited=$((waited + 1)); done
    if ! desktop_running; then
      REOPEN_DESKTOP=1
      return 0
    fi
  fi
  echo "install: quit $DESKTOP_APP completely first (including from the tray), then re-run" >&2
  exit 1
}

# `dsh plugin` needs pnpm on PATH outside Desktop; borrow one through npx when it is missing.
SHIM=''
cleanup() { if [ -n "$SHIM" ]; then rm -rf "$SHIM"; fi; }
trap cleanup EXIT
ensure_pnpm() {
  if [ -z "$SHIM" ] && ! command -v pnpm >/dev/null 2>&1; then
    SHIM="$(mktemp -d)"
    printf '#!/bin/sh\nexec npx -y pnpm@11 "$@"\n' > "$SHIM/pnpm"
    chmod +x "$SHIM/pnpm"
    PATH="$SHIM:$PATH"
  fi
}

# Set DSH to the command that manages $1.
select_dsh() {
  if [ -n "${DSH_TELEGRAM_DSH:-}" ]; then
    read -r -a DSH <<< "$DSH_TELEGRAM_DSH"
  elif [ "$1" = desktop ]; then
    DSH=("$(desktop_dsh)")
    if [ -z "${DSH[0]}" ]; then
      echo 'install: the dsh command of DeepSeek Harness Desktop was not found; register it from the app menu (Manage dsh command…)' >&2
      exit 1
    fi
  else
    if ! node_ok; then
      echo 'install: Node.js 22.19+ or 24+ is required' >&2
      exit 1
    fi
    DSH=(npx -y @deepseek-ai/dsh)
  fi
  if [ "$1" != desktop ]; then ensure_pnpm; fi
}

# Only `dependencies` uses the package name as a key; the bundle list holds it as a value.
installed_by_pnpm() {
  [ -f "$1/package.json" ] && grep -qE "\"$PACKAGE\"[[:space:]]*:" "$1/package.json"
}

# Keep a patch file valid after removing rows: an empty one becomes `[]`.
replace_patch() {
  local patch="$1" cleaned="$2"
  grep -qE '^[[:space:]]*[^#[:space:]]' "$cleaned" || printf '[]\n' >> "$cleaned"
  mv "$cleaned" "$patch"
}

# Releases up to 0.2.x copied the plugin into the profile and inserted a
# marked row into its patch; remove both so the bundle row is the only one.
remove_copy_install() {
  local dir="$1" patch="$1/cordis.patch.yml"
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
    replace_patch "$patch" "$cleaned"
    echo "removed the old telegram row from $patch"
  fi
  if [ -d "$dir/node_modules/$PACKAGE" ] && ! installed_by_pnpm "$dir"; then
    rm -rf "${dir:?}/node_modules/$PACKAGE"
    echo "removed the old copied plugin from $dir/node_modules"
  fi
}

# The Plugins page saves the bot settings as a top-level `- id: telegram` row of
# the profile patch; uninstalling drops it with the plugin.
remove_settings_row() {
  local patch="$1/cordis.patch.yml"
  [ -f "$patch" ] && grep -qE "^- id: ['\"]?telegram['\"]?[[:space:]]*$" "$patch" || return 0
  local cleaned
  cleaned="$(mktemp "$patch.XXXXXX")"
  awk '
    /^- id: ['\''"]?telegram['\''"]?[[:space:]]*$/ { skip = 1; next }
    skip && /^[^[:space:]]/ { skip = 0 }
    !skip { print }
  ' "$patch" > "$cleaned"
  replace_patch "$patch" "$cleaned"
  echo "removed the Telegram settings from $patch"
}

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

manage() {
  local profile="$1" dir="$DSH_HOME/profiles/$1"
  select_dsh "$profile"
  if [ "$profile" = desktop ]; then quit_desktop; fi
  remove_copy_install "$dir"
  if [ "$ACTION" = uninstall ]; then
    if installed_by_pnpm "$dir"; then
      "${DSH[@]}" plugin --profile "$profile" remove "$PACKAGE"
      echo "uninstalled $PACKAGE from profile $profile"
    else
      echo "note: $PACKAGE is not installed in profile $profile"
    fi
    remove_settings_row "$dir"
    return
  fi
  # pnpm keeps the commit a git spec resolved to in the lockfile, so re-adding the same
  # spec reports "Already up to date"; `update` re-resolves it to the branch tip.
  if [ "$SPEC" = "$REMOTE_SPEC" ] && [ -f "$dir/package.json" ] \
    && grep -qE "\"$PACKAGE\"[[:space:]]*:[[:space:]]*\"$REMOTE_SPEC\"" "$dir/package.json"; then
    "${DSH[@]}" plugin --profile "$profile" update "$PACKAGE"
  elif [ "${SPEC%%:*}" = file ] && [ -f "$dir/package.json" ] \
    && sed -E 's/"[[:space:]]*:[[:space:]]*"/":"/g' "$dir/package.json" | grep -qF "\"$PACKAGE\":\"$SPEC\""; then
    # pnpm copies a `file:` directory once and reports a re-add of the same spec as
    # up to date, so a checkout's new build only lands after removing the old copy.
    "${DSH[@]}" plugin --profile "$profile" remove "$PACKAGE"
    "${DSH[@]}" plugin --profile "$profile" add "$SPEC"
  else
    "${DSH[@]}" plugin --profile "$profile" add "$SPEC"
  fi
  echo "installed $PACKAGE into profile $profile"
}

for profile in "${PROFILES[@]}"; do manage "$profile"; done

if [ -n "$REOPEN_DESKTOP" ]; then open -a "$DESKTOP_APP" >/dev/null 2>&1 || true; fi
if [ "$ACTION" = uninstall ]; then
  echo 'done; restart DSH to apply'
  exit 0
fi
START=''
for profile in "${PROFILES[@]}"; do
  if [ "$profile" = desktop ]; then
    if [ -n "$REOPEN_DESKTOP" ]; then step='DeepSeek Harness Desktop (reopened)'; else step='open DeepSeek Harness Desktop'; fi
  elif [ "$profile" = web ]; then
    step='npx @deepseek-ai/dsh web'
  else
    step="npx @deepseek-ai/dsh --profile $profile"
  fi
  START="${START:+$START  |  }$step"
done
cat <<EOF

Done. Next / 下一步:
  1. Start DSH / 启动 DSH: $START
  2. In DSH open Plugins → dsh-telegram, fill in the Bot Token and your Telegram user id, then Save.
     在 DSH 中打开「插件」→ dsh-telegram，填写 Bot Token 和你的 Telegram 用户 ID，保存即可。
EOF
