#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_USER="${SUDO_USER:-$(id -un)}"
REAL_HOME="$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6 || true)"
if [[ -z "$REAL_HOME" ]]; then
  REAL_HOME="$HOME"
fi
EXT_ROOT="${ANTIGRAVITY_EXTENSIONS_DIR:-$REAL_HOME/.antigravity-ide/extensions}"
IDE_APP_ROOT="${ANTIGRAVITY_IDE_APP_ROOT:-}"
VSIX_PATH=""
UNINSTALL=0
HOOK_ONLY=0
ENABLE_AUTO_REPAIR=0
DISABLE_AUTO_REPAIR=0

usage() {
  cat <<'EOF'
Usage: install-ide-enhancer.sh [options]
  --uninstall              Restore backups and remove extension & UI hook
  --hook-only              Patch IDE UI hook only (keep existing Open VSX extension)
  --enable-auto-repair     Install systemd.path watcher to auto-repair after IDE updates
  --disable-auto-repair    Remove systemd.path post-update auto-repair watcher
  --vsix <path|auto>       Install from a .vsix archive (or "auto" to pick local .vsix)
  --ext-root <dir>         Override extensions directory (default: ~/.antigravity-ide/extensions)
  --ide-app-root <dir>     Override Antigravity IDE resources/app directory
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1; shift ;;
    --hook-only) HOOK_ONLY=1; shift ;;
    --enable-auto-repair) ENABLE_AUTO_REPAIR=1; shift ;;
    --disable-auto-repair) DISABLE_AUTO_REPAIR=1; shift ;;
    --vsix) VSIX_PATH="${2:-}"; shift 2 ;;
    --ext-root) EXT_ROOT="${2:-}"; shift 2 ;;
    --ide-app-root) IDE_APP_ROOT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    echo "node"
  elif [[ -x "/opt/antigravity-ide/antigravity-ide" ]]; then
    echo "ELECTRON_RUN_AS_NODE=1 /opt/antigravity-ide/antigravity-ide"
  else
    echo "Error: node (or Antigravity IDE Electron binary) is required." >&2
    exit 1
  fi
}

run_node() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
  else
    ELECTRON_RUN_AS_NODE=1 /opt/antigravity-ide/antigravity-ide "$@"
  fi
}

resolve_ide_app_root() {
  if [[ -n "$IDE_APP_ROOT" ]]; then
    echo "$IDE_APP_ROOT"
    return
  fi
  local candidates=(
    "/opt/antigravity-ide/resources/app"
    "/usr/share/antigravity-ide/resources/app"
    "$HOME/.local/share/antigravity-ide/resources/app"
    "/Applications/Antigravity IDE.app/Contents/Resources/app"
  )
  for c in "${candidates[@]}"; do
    if [[ -d "$c" ]]; then
      echo "$c"
      return
    fi
  done
  echo ""
}

APP_ROOT="$(resolve_ide_app_root)"
WB_DIR="${APP_ROOT:+$APP_ROOT/out/vs/code/electron-browser/workbench}"
AGY_EXT_JS="${APP_ROOT:+$APP_ROOT/extensions/agy/vscode/extension.js}"
EXT_JSON="$EXT_ROOT/extensions.json"

RESOLVED_VSIX=""
if [[ -n "$VSIX_PATH" && $UNINSTALL -eq 0 ]]; then
  if [[ "$VSIX_PATH" == "auto" ]]; then
    RESOLVED_VSIX="$(ls -t "$SCRIPT_DIR"/build/*.vsix "$SCRIPT_DIR"/*.vsix 2>/dev/null | head -n1 || true)"
  else
    RESOLVED_VSIX="$VSIX_PATH"
  fi
  if [[ -z "$RESOLVED_VSIX" || ! -f "$RESOLVED_VSIX" ]]; then
    echo "VSIX package not found: $VSIX_PATH" >&2
    exit 1
  fi
fi

if [[ $UNINSTALL -eq 1 ]]; then
  PKG_JSON_SRC="$SCRIPT_DIR/package.json"
  META="$(run_node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.publisher+'.'+p.name)" "$PKG_JSON_SRC")"
  EXT_ID="$META"
  LEGACY_ID="local.antigravity-prompt-enhancer"

  if [[ -n "$WB_DIR" && -d "$WB_DIR" ]]; then
    for f in workbench.html workbench-jetski-agent.html; do
      hp="$WB_DIR/$f"
      bak="$hp.enhancer.bak"
      if [[ -f "$bak" ]]; then
        cp -f "$bak" "$hp"
        rm -f "$bak"
        echo "Restored $f"
      fi
    done
    rm -f "$WB_DIR/enhance-ide-hook.js" "$WB_DIR/enhance-ide-hook-config.json"
  fi

  if [[ -n "$APP_ROOT" && -f "$APP_ROOT/product.json" ]]; then
    run_node -e "const ext=require(process.argv[1]);ext.syncProductJsonChecksums(process.argv[2]);" "$SCRIPT_DIR/extension.js" "$APP_ROOT"
  fi

  if [[ -n "$AGY_EXT_JS" && -f "$AGY_EXT_JS.enhancer.bak" ]]; then
    cp -f "$AGY_EXT_JS.enhancer.bak" "$AGY_EXT_JS"
    rm -f "$AGY_EXT_JS.enhancer.bak"
    echo "Restored extensions/agy/vscode/extension.js"
  fi

  if [[ -f "$EXT_JSON" ]]; then
    run_node -e "
      const fs=require('fs'), p=process.argv[1], id=process.argv[2], leg=process.argv[3];
      const raw=fs.readFileSync(p,'utf8').trim();
      if(!raw) process.exit(0);
      const arr=JSON.parse(raw);
      const kept=(Array.isArray(arr)?arr:[arr]).filter(x=>x?.identifier?.id!==id&&x?.identifier?.id!==leg);
      fs.writeFileSync(p, JSON.stringify(kept), 'utf8');
    " "$EXT_JSON" "$EXT_ID" "$LEGACY_ID"
  fi

  if [[ -d "$EXT_ROOT" ]]; then
    find "$EXT_ROOT" -maxdepth 1 -type d \( -name "$EXT_ID-*" -o -name "$LEGACY_ID-*" \) -exec rm -rf {} +
  fi
  if [[ -f "$SCRIPT_DIR/repair-ide-hook.js" ]]; then
    run_node "$SCRIPT_DIR/repair-ide-hook.js" --disable-auto-repair || true
  fi
  rm -f "$REAL_HOME/.antigravity-enhancer/config.json"
  echo "[IDE ENHANCER UNINSTALLED]"
  exit 0
fi

if [[ $HOOK_ONLY -eq 1 ]]; then
  if [[ -z "$APP_ROOT" || ! -d "$WB_DIR" ]]; then
    echo "Error: Antigravity IDE workbench directory not found." >&2
    exit 1
  fi
  HOOK_EXT_DIR="$(ls -dt "$EXT_ROOT"/kyuzan0.ag-ide-prompt-enhancer-* 2>/dev/null | head -n1 || true)"
  if [[ -z "$HOOK_EXT_DIR" || ! -f "$HOOK_EXT_DIR/extension.js" ]]; then
    HOOK_EXT_DIR="$SCRIPT_DIR"
  fi
  REPAIR_SCRIPT="$HOOK_EXT_DIR/repair-ide-hook.js"
  if [[ ! -f "$REPAIR_SCRIPT" ]]; then
    REPAIR_SCRIPT="$SCRIPT_DIR/repair-ide-hook.js"
  fi
  REPAIR_ARGS=(--ext-dir "$HOOK_EXT_DIR" --app-root "$APP_ROOT")
  if [[ $ENABLE_AUTO_REPAIR -eq 1 ]]; then
    REPAIR_ARGS+=(--enable-auto-repair)
  elif [[ $DISABLE_AUTO_REPAIR -eq 1 ]]; then
    REPAIR_ARGS+=(--disable-auto-repair)
  fi
  run_node "$REPAIR_SCRIPT" "${REPAIR_ARGS[@]}"
  exit 0
fi

TMP_STAGE="$(mktemp -d)"
trap 'rm -rf "$TMP_STAGE"' EXIT

if [[ -n "$RESOLVED_VSIX" ]]; then
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$RESOLVED_VSIX" "extension/*" -d "$TMP_STAGE"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); [z.extract(m,sys.argv[2]) for m in z.namelist() if m.startswith('extension/')]" "$RESOLVED_VSIX" "$TMP_STAGE"
  else
    echo "unzip or python3 is required to extract VSIX" >&2
    exit 1
  fi
  STAGE_EXT="$TMP_STAGE/extension"
else
  STAGE_EXT="$TMP_STAGE/extension"
  mkdir -p "$STAGE_EXT"
  for f in package.json extension.js enhance-ide-hook.js repair-ide-hook.js LICENSE README.md CHANGELOG.md; do
    if [[ -f "$SCRIPT_DIR/$f" ]]; then cp -f "$SCRIPT_DIR/$f" "$STAGE_EXT/$f"; fi
  done
fi

readarray -t PKG_META < <(run_node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.publisher);console.log(p.name);console.log(p.version)" "$STAGE_EXT/package.json")
EXT_PUB="${PKG_META[0]}"
EXT_NAME="${PKG_META[1]}"
EXT_VER="${PKG_META[2]}"
EXT_ID="$EXT_PUB.$EXT_NAME"
LEGACY_ID="local.antigravity-prompt-enhancer"
EXT_FOLDER="$EXT_ID-$EXT_VER-universal"
DST_DIR="$EXT_ROOT/$EXT_FOLDER"

mkdir -p "$EXT_ROOT" "$DST_DIR"
cp -R "$STAGE_EXT"/. "$DST_DIR"/
find "$EXT_ROOT" -maxdepth 1 -type d \( -name "$EXT_ID-*" -o -name "$LEGACY_ID-*" \) ! -name "$EXT_FOLDER" -exec rm -rf {} +

run_node -e "
  const fs=require('fs'), p=process.argv[1], id=process.argv[2], leg=process.argv[3], ver=process.argv[4], dst=process.argv[5], rel=process.argv[6];
  let entries=[];
  if(fs.existsSync(p)){
    const raw=fs.readFileSync(p,'utf8').trim();
    if(raw){
      const parsed=JSON.parse(raw);
      entries=(Array.isArray(parsed)?parsed:[parsed]).filter(x=>x?.identifier?.id!==id&&x?.identifier?.id!==leg);
    }
  }
  entries.push({
    identifier:{id},
    version:ver,
    location:{'\$mid':1,fsPath:dst,external:'file://'+dst,path:dst,scheme:'file'},
    relativeLocation:rel,
    metadata:{installedTimestamp:Date.now(),pinned:true,source:'vsix',isApplicationScoped:false,isMachineScoped:false,isBuiltin:false,updated:false}
  });
  fs.writeFileSync(p, JSON.stringify(entries), 'utf8');
" "$EXT_JSON" "$EXT_ID" "$LEGACY_ID" "$EXT_VER" "$DST_DIR" "$EXT_FOLDER"

if [[ -n "$APP_ROOT" && -d "$WB_DIR" ]]; then
  REPAIR_SCRIPT="$DST_DIR/repair-ide-hook.js"
  if [[ ! -f "$REPAIR_SCRIPT" ]]; then
    REPAIR_SCRIPT="$SCRIPT_DIR/repair-ide-hook.js"
  fi
  REPAIR_ARGS=(--ext-dir "$DST_DIR" --app-root "$APP_ROOT")
  if [[ $ENABLE_AUTO_REPAIR -eq 1 ]]; then
    REPAIR_ARGS+=(--enable-auto-repair)
  elif [[ $DISABLE_AUTO_REPAIR -eq 1 ]]; then
    REPAIR_ARGS+=(--disable-auto-repair)
  fi
  run_node "$REPAIR_SCRIPT" "${REPAIR_ARGS[@]}"
elif [[ -n "$APP_ROOT" ]]; then
  echo "Warning: workbench directory not found at $WB_DIR" >&2
fi

echo "[IDE ENHANCER INSTALLED] $DST_DIR"
