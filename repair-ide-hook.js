#!/usr/bin/env node
/**
 * Elevated / post-update IDE hook repair runner for Antigravity IDE Prompt Enhancer.
 * Bundled inside the VSIX so Open VSX users can repair read-only IDE installations
 * via pkexec / osascript / UAC without cloning the repository.
 *
 * Usage:
 *   node repair-ide-hook.js --ext-dir <dir> --app-root <dir> [--enable-auto-repair] [--disable-auto-repair]
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SYSTEMD_SERVICE_NAME = "antigravity-enhancer-repair.service";
const SYSTEMD_PATH_NAME = "antigravity-enhancer-repair.path";
const DEFAULT_SYSTEMD_DIR = "/etc/systemd/system";
const DEFAULT_INSTALL_LIB_DIR = "/usr/local/lib/antigravity-enhancer";

function parseArgs(argv) {
  const opts = {
    extDir: "",
    appRoot: "",
    enableAutoRepair: false,
    disableAutoRepair: false,
    systemdDir: DEFAULT_SYSTEMD_DIR,
    installLibDir: DEFAULT_INSTALL_LIB_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ext-dir" && argv[i + 1]) {
      opts.extDir = argv[++i];
    } else if (arg === "--app-root" && argv[i + 1]) {
      opts.appRoot = argv[++i];
    } else if (arg === "--enable-auto-repair") {
      opts.enableAutoRepair = true;
    } else if (arg === "--disable-auto-repair") {
      opts.disableAutoRepair = true;
    } else if (arg === "--systemd-dir" && argv[i + 1]) {
      opts.systemdDir = argv[++i];
    } else if (arg === "--install-lib-dir" && argv[i + 1]) {
      opts.installLibDir = argv[++i];
    }
  }
  return opts;
}

function systemdQuote(value) {
  const str = String(value || "");
  if (!/[\s"'\\]/.test(str)) return str;
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function resolveElectronBinary(appRoot) {
  const candidate = path.resolve(appRoot, "..", "..", "antigravity-ide");
  if (fs.existsSync(candidate)) return candidate;
  if (fs.existsSync("/opt/antigravity-ide/antigravity-ide")) return "/opt/antigravity-ide/antigravity-ide";
  return process.execPath;
}

function installSystemdAutoRepair({ extDir, appRoot, systemdDir = DEFAULT_SYSTEMD_DIR, installLibDir = DEFAULT_INSTALL_LIB_DIR }) {
  const libDir = path.resolve(installLibDir);
  fs.mkdirSync(libDir, { recursive: true, mode: 0o755 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(libDir, 0o755);
    } catch {
      // ignore
    }
  }

  for (const file of ["extension.js", "enhance-ide-hook.js", "repair-ide-hook.js"]) {
    const src = path.join(extDir, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required file for auto-repair: ${src}`);
    }
    const dst = path.join(libDir, file);
    fs.copyFileSync(src, dst);
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(dst, 0o644);
      } catch {
        // ignore
      }
    }
  }

  const electronBin = resolveElectronBinary(appRoot);
  const runnerPath = path.join(libDir, "repair-ide-hook.js");
  const serviceContent = [
    "[Unit]",
    "Description=Antigravity IDE Prompt Enhancer Post-Update Hook Repair",
    "",
    "[Service]",
    "Type=oneshot",
    "Environment=ELECTRON_RUN_AS_NODE=1",
    `ExecStart=${systemdQuote(electronBin)} ${systemdQuote(runnerPath)} --ext-dir ${systemdQuote(libDir)} --app-root ${systemdQuote(appRoot)}`,
    "",
  ].join("\n");

  const agyExtJs = path.join(appRoot, "extensions", "agy", "vscode", "extension.js");
  const wbHtml = path.join(appRoot, "out", "vs", "code", "electron-browser", "workbench", "workbench.html");
  const pathContent = [
    "[Unit]",
    "Description=Watch Antigravity IDE files for updates (Prompt Enhancer)",
    "",
    "[Path]",
    `PathChanged=${agyExtJs}`,
    `PathChanged=${wbHtml}`,
    `Unit=${SYSTEMD_SERVICE_NAME}`,
    "TriggerLimitIntervalSec=10s",
    "TriggerLimitBurst=3",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");

  fs.mkdirSync(systemdDir, { recursive: true, mode: 0o755 });
  const servicePath = path.join(systemdDir, SYSTEMD_SERVICE_NAME);
  const pathUnitPath = path.join(systemdDir, SYSTEMD_PATH_NAME);
  fs.writeFileSync(servicePath, serviceContent, { encoding: "utf8", mode: 0o644 });
  fs.writeFileSync(pathUnitPath, pathContent, { encoding: "utf8", mode: 0o644 });

  if (path.resolve(systemdDir) === DEFAULT_SYSTEMD_DIR) {
    execFileSync("systemctl", ["daemon-reload"], { stdio: "ignore" });
    execFileSync("systemctl", ["enable", "--now", SYSTEMD_PATH_NAME], { stdio: "ignore" });
  }

  return { servicePath, pathUnitPath, installLibDir: libDir };
}

function disableSystemdAutoRepair({ systemdDir = DEFAULT_SYSTEMD_DIR, installLibDir = DEFAULT_INSTALL_LIB_DIR } = {}) {
  const isRealSystemd = path.resolve(systemdDir) === DEFAULT_SYSTEMD_DIR;
  if (isRealSystemd) {
    try {
      execFileSync("systemctl", ["disable", "--now", SYSTEMD_PATH_NAME], { stdio: "ignore" });
    } catch {
      // ignore if not enabled
    }
  }
  for (const name of [SYSTEMD_PATH_NAME, SYSTEMD_SERVICE_NAME]) {
    const unitPath = path.join(systemdDir, name);
    if (fs.existsSync(unitPath)) {
      fs.rmSync(unitPath, { force: true });
    }
  }
  const libDir = path.resolve(installLibDir);
  if (fs.existsSync(libDir)) {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
  if (isRealSystemd) {
    try {
      execFileSync("systemctl", ["daemon-reload"], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }
  return { disabled: true };
}

function runRepairCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.disableAutoRepair && !opts.extDir && !opts.appRoot) {
    const disabled = disableSystemdAutoRepair({
      systemdDir: opts.systemdDir,
      installLibDir: opts.installLibDir,
    });
    return { ok: true, status: null, autoRepairEnabled: false, ...disabled };
  }

  if (!opts.extDir || !opts.appRoot) {
    throw new Error("Both --ext-dir and --app-root are required.");
  }

  const extDir = path.resolve(opts.extDir);
  const appRoot = path.resolve(opts.appRoot);
  const wbDir = path.join(appRoot, "out", "vs", "code", "electron-browser", "workbench");
  if (!fs.existsSync(wbDir)) {
    throw new Error(`Workbench directory not found in appRoot: ${wbDir}`);
  }
  const extJsPath = path.join(extDir, "extension.js");
  const hookJsPath = path.join(extDir, "enhance-ide-hook.js");
  if (!fs.existsSync(extJsPath) || !fs.existsSync(hookJsPath)) {
    throw new Error(`Missing extension.js or enhance-ide-hook.js in extDir: ${extDir}`);
  }

  const ext = require(extJsPath);
  // Never overwrite the user's ~/.antigravity-enhancer/config.json while running elevated as root.
  const status = ext.ensureIdeHookInstalled({ extensionPath: extDir }, 47831, "", appRoot, {
    skipConfigOverwrite: true,
  });

  if (status && status.permissionDenied) {
    throw new Error(status.reason || "Permission denied while patching IDE hook");
  }

  let autoRepairEnabled = false;
  if (opts.enableAutoRepair) {
    installSystemdAutoRepair({
      extDir,
      appRoot,
      systemdDir: opts.systemdDir,
      installLibDir: opts.installLibDir,
    });
    autoRepairEnabled = true;
  } else if (opts.disableAutoRepair) {
    disableSystemdAutoRepair({
      systemdDir: opts.systemdDir,
      installLibDir: opts.installLibDir,
    });
  }

  return { ok: true, status, autoRepairEnabled };
}

if (require.main === module) {
  try {
    const result = runRepairCli(process.argv.slice(2));
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  installSystemdAutoRepair,
  disableSystemdAutoRepair,
  runRepairCli,
};
