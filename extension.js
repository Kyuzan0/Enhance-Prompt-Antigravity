let vscode = null;
try {
  vscode = require("vscode");
} catch {
  // Running outside VS Code extension host (e.g. unit tests).
}
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const HOOK_SCRIPT_NAME = "enhance-ide-hook.js";
const HOOK_CONFIG_NAME = "enhance-ide-hook-config.json";
const SCRIPT_TAG = `<script src="./${HOOK_SCRIPT_NAME}" type="module"></script>`;
const IFRAME_HOOK_MARKER = "/*AGY_ENHANCER_IFRAME_HOOK*/";
const HUB_COOKIE_NAME = "agy_enhancer_hub";
const DEFAULT_PREFERRED_PORT = 47831;
const DEFAULT_TIMEOUT_MS = 60000;

const VALID_OUTPUT_LANGUAGES = new Set(["auto", "id", "en"]);
const VALID_DETAIL_LEVELS = new Set(["concise", "balanced", "comprehensive"]);
const PERSISTABLE_SETTING_KEYS = [
  "shortcutEnabled",
  "shortcut",
  "outputLanguage",
  "detailLevel",
  "includeWorkspaceContext",
  "includeConversationContext",
  "showToast",
];

const DEFAULT_SETTINGS = Object.freeze({
  shortcutEnabled: true,
  shortcut: "Ctrl+Alt+E",
  outputLanguage: "auto",
  detailLevel: "balanced",
  includeWorkspaceContext: true,
  includeConversationContext: true,
  showToast: true,
  proxyPort: DEFAULT_PREFERRED_PORT,
  cliPath: "",
  timeoutMs: DEFAULT_TIMEOUT_MS,
});

function normalizeShortcut(raw) {
  const input = String(raw || "").trim();
  if (!input) return DEFAULT_SETTINGS.shortcut;

  const parts = input.split("+").map((p) => p.trim()).filter(Boolean);
  let hasCtrl = false;
  let hasAlt = false;
  let hasShift = false;
  let hasMeta = false;
  let mainKey = "";

  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === "ctrl" || low === "control") hasCtrl = true;
    else if (low === "alt" || low === "option") hasAlt = true;
    else if (low === "shift") hasShift = true;
    else if (low === "cmd" || low === "meta" || low === "super" || low === "win") hasMeta = true;
    else mainKey = part;
  }

  if (!mainKey) return DEFAULT_SETTINGS.shortcut;
  // Require at least one modifier key so normal typing is never hijacked.
  if (!hasCtrl && !hasAlt && !hasShift && !hasMeta) return DEFAULT_SETTINGS.shortcut;

  const normKey = mainKey.length === 1 ? mainKey.toUpperCase() : mainKey[0].toUpperCase() + mainKey.slice(1);
  const out = [];
  if (hasCtrl) out.push("Ctrl");
  if (hasAlt) out.push("Alt");
  if (hasShift) out.push("Shift");
  if (hasMeta) out.push("Cmd");
  out.push(normKey);
  return out.join("+");
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const lang = String(src.outputLanguage || DEFAULT_SETTINGS.outputLanguage).toLowerCase();
  const detail = String(src.detailLevel || DEFAULT_SETTINGS.detailLevel).toLowerCase();
  const portNum = Number(src.proxyPort);
  const timeoutNum = Number(src.timeoutMs);

  return {
    shortcutEnabled: src.shortcutEnabled !== undefined ? Boolean(src.shortcutEnabled) : DEFAULT_SETTINGS.shortcutEnabled,
    shortcut: normalizeShortcut(src.shortcut !== undefined ? src.shortcut : DEFAULT_SETTINGS.shortcut),
    outputLanguage: VALID_OUTPUT_LANGUAGES.has(lang) ? lang : DEFAULT_SETTINGS.outputLanguage,
    detailLevel: VALID_DETAIL_LEVELS.has(detail) ? detail : DEFAULT_SETTINGS.detailLevel,
    includeWorkspaceContext:
      src.includeWorkspaceContext !== undefined ? Boolean(src.includeWorkspaceContext) : DEFAULT_SETTINGS.includeWorkspaceContext,
    includeConversationContext:
      src.includeConversationContext !== undefined
        ? Boolean(src.includeConversationContext)
        : DEFAULT_SETTINGS.includeConversationContext,
    showToast: src.showToast !== undefined ? Boolean(src.showToast) : DEFAULT_SETTINGS.showToast,
    proxyPort:
      Number.isInteger(portNum) && portNum > 0 && portNum < 65536 ? portNum : DEFAULT_SETTINGS.proxyPort,
    cliPath: typeof src.cliPath === "string" ? src.cliPath.trim() : DEFAULT_SETTINGS.cliPath,
    timeoutMs:
      Number.isFinite(timeoutNum) && timeoutNum >= 1000 ? Math.floor(timeoutNum) : DEFAULT_SETTINGS.timeoutMs,
  };
}

function getExtensionSetting(key, fallback) {
  try {
    const cfg = vscode && vscode.workspace && vscode.workspace.getConfiguration("antigravityPromptEnhancer");
    if (cfg) {
      const val = cfg.get(key);
      if (val !== undefined && val !== null && val !== "") return val;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function readAllSettings() {
  const raw = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    raw[key] = getExtensionSetting(key, DEFAULT_SETTINGS[key]);
  }
  const envPort = Number(process.env.AGY_ENHANCER_PORT || 0);
  if (Number.isInteger(envPort) && envPort > 0 && envPort < 65536) raw.proxyPort = envPort;
  const envTimeout = Number(process.env.AGY_ENHANCER_TIMEOUT_MS || 0);
  if (Number.isFinite(envTimeout) && envTimeout >= 1000) raw.timeoutMs = Math.floor(envTimeout);
  if (process.env.AGY_CLI_BIN && process.env.AGY_CLI_BIN.trim()) raw.cliPath = process.env.AGY_CLI_BIN.trim();
  return normalizeSettings(raw);
}

async function saveSettingsPatch(patch) {
  const current = readAllSettings();
  const merged = normalizeSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
  if (vscode && vscode.workspace) {
    const cfg = vscode.workspace.getConfiguration("antigravityPromptEnhancer");
    const target = vscode.ConfigurationTarget ? vscode.ConfigurationTarget.Global : true;
    for (const key of PERSISTABLE_SETTING_KEYS) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
        await cfg.update(key, merged[key], target);
      }
    }
  }
  return readAllSettings();
}

function resolvePreferredPort() {
  const envPort = Number(process.env.AGY_ENHANCER_PORT || 0);
  if (Number.isInteger(envPort) && envPort > 0 && envPort < 65536) return envPort;
  const cfgPort = Number(getExtensionSetting("proxyPort", DEFAULT_PREFERRED_PORT));
  return Number.isInteger(cfgPort) && cfgPort > 0 && cfgPort < 65536 ? cfgPort : DEFAULT_PREFERRED_PORT;
}

function resolveEnhanceTimeoutMs() {
  const envMs = Number(process.env.AGY_ENHANCER_TIMEOUT_MS || 0);
  if (Number.isFinite(envMs) && envMs >= 1000) return envMs;
  const cfgMs = Number(getExtensionSetting("timeoutMs", DEFAULT_TIMEOUT_MS));
  return Number.isFinite(cfgMs) && cfgMs >= 1000 ? cfgMs : DEFAULT_TIMEOUT_MS;
}

function resolveDynamicModel(rawModel) {
  let candidate = (rawModel || "").trim();
  if (!candidate) {
    const home = os.homedir();
    for (const rel of [
      [".gemini", "antigravity", "settings.json"],
      [".gemini", "antigravity-cli", "settings.json"],
    ]) {
      try {
        const p = path.join(home, ...rel);
        if (fs.existsSync(p)) {
          const data = JSON.parse(fs.readFileSync(p, "utf8"));
          if (data && typeof data.model === "string" && data.model.trim()) {
            candidate = data.model.trim();
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }
  if (!candidate) return "";

  const lower = candidate.toLowerCase();
  if (!/[()]/.test(lower) && lower.includes("-")) {
    return lower;
  }

  let effort = "low";
  if (lower.includes("xhigh")) effort = "xhigh";
  else if (lower.includes("max")) effort = "max";
  else if (lower.includes("high") || lower.includes("thinking")) effort = "high";
  else if (lower.includes("medium")) effort = "medium";

  const base = candidate
    .replace(/(?:\s*(?:\((?:low|medium|high|xhigh|max|thinking)\)|\b(?:low|medium|high|xhigh|max|thinking|New|Beta)\b)\s*)+$/i, "")
    .trim()
    .toLowerCase();

  if (base.includes("orchestrator")) return "gemini-pro-orchestrator-g1-pro";
  if (base.includes("gpt-oss") || base.includes("120b")) return "gpt-oss-120b-medium";
  if (base.startsWith("gemini ")) {
    const slug = base.replace(/\s+/g, "-").replace(new RegExp(`(-${effort})+$`), "");
    return `${slug}-${effort}`;
  }
  if (base.startsWith("claude ")) {
    if (base.includes("4.6") || base.includes("4-6")) {
      return base.includes("opus") ? "claude-opus-4-6-thinking" : "claude-sonnet-4-6";
    }
    const slug = base.replace(/\./g, "-").replace(/\s+/g, "-").replace(new RegExp(`(-${effort})+$`), "");
    return `${slug}-${effort}`;
  }
  return candidate;
}

function collectWorkspaceContext(cwd) {
  const lines = [];
  if (!cwd || !fs.existsSync(cwd)) return "";
  try {
    lines.push(`Workspace path: ${cwd}`);
    const entries = fs.readdirSync(cwd, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && !["node_modules", "dist", "temp", "tmp", "vendor"].includes(d.name))
      .slice(0, 40)
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
    if (entries.length > 0) {
      lines.push(`Top-level files & folders: ${entries.join(", ")}`);
    }

    const goModPath = path.join(cwd, "go.mod");
    if (fs.existsSync(goModPath)) {
      const goMod = fs.readFileSync(goModPath, "utf8").split(/\r?\n/).slice(0, 6).join(" | ");
      lines.push(`go.mod: ${goMod}`);
    }

    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      lines.push(`package.json: name=${pkg.name || "?"}, scripts=${Object.keys(pkg.scripts || {}).join(",")}`);
    }

    if (vscode && vscode.window) {
      const activeFile = vscode.window.activeTextEditor?.document?.uri?.fsPath;
      if (activeFile) {
        lines.push(`Active editor file: ${path.relative(cwd, activeFile) || activeFile}`);
      }

      const openTabs = [];
      for (const group of vscode.window.tabGroups?.all || []) {
        for (const tab of group.tabs || []) {
          const p = tab.input && tab.input.uri && tab.input.uri.fsPath;
          if (p) openTabs.push(path.relative(cwd, p) || p);
        }
      }
      if (openTabs.length > 0) {
        lines.push(`Open editor tabs: ${[...new Set(openTabs)].slice(0, 12).join(", ")}`);
      }
    }
  } catch {
    // ignore
  }
  return lines.join("\n");
}

function findAgyCliBinary() {
  const explicit = (process.env.AGY_CLI_BIN || getExtensionSetting("cliPath", "") || "").trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const home = os.homedir();
  const isWin = process.platform === "win32";
  const candidates = isWin
    ? [
        path.join(home, ".gemini", "bin", "agy.exe"),
        path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "agy", "bin", "agy-real.exe"),
      ]
    : [
        path.join(home, ".gemini", "bin", "agy"),
        "/usr/local/bin/agy",
        "/usr/bin/agy",
      ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        // On Windows ensure we pick the native >=50MB binary rather than a thin shim/wrapper.
        if (!isWin || fs.statSync(c).size >= 50 * 1024 * 1024) {
          return c;
        }
      }
    } catch {
      // ignore
    }
  }
  return "";
}

function buildEnhancePrompt(draft, context, workspaceContext, settings) {
  const effectiveSettings = normalizeSettings(settings);
  const langRule =
    effectiveSettings.outputLanguage === "id"
      ? "5. Write the enhanced prompt in clear, natural Indonesian (keep code identifiers/paths accurate)."
      : effectiveSettings.outputLanguage === "en"
        ? "5. Write the enhanced prompt in clear, concise English."
        : "5. Preserve the user's original language (Indonesian or English).";

  const detailRule =
    effectiveSettings.detailLevel === "concise"
      ? "2. Keep the enhanced prompt concise and compact (around 1-4 short sentences or brief bullets), avoiding verbose section templates."
      : effectiveSettings.detailLevel === "comprehensive"
        ? "2. Make the prompt thorough and production-grade—explicitly detailing objective, architecture/file scope, edge cases & error handling, constraints, and concrete verification steps."
        : "2. Make the prompt complete, clear, and actionable—covering objective, specific scope/files/components relevant to this project and discussion, concrete analysis or implementation steps, and expected output/verification.";

  const parts = [
    "You are a Senior Software Architect and Prompt Engineer.",
    "Rewrite and enhance the user's raw prompt into a clear, project-specific prompt that gives the AI coding assistant everything it needs to execute accurately.",
    "",
    "CRITICAL RULES:",
    "1. Anchor the enhanced prompt in the CONVERSATION CONTEXT and WORKSPACE CONTEXT below (when provided):",
    "   - Resolve all references ('itu', 'tadi', 'projek ini', 'fitur ini') using the actual discussion, tech stack, manifests, directories, and open files listed below.",
    "   - NEVER include generic boilerplate examples (like 'misal: composer.json, requirements.txt, MVC/N+1 queries') that do NOT apply to this actual workspace.",
    detailRule,
    "3. Stay strictly faithful to the user's intent and the active discussion.",
    "4. Output ONLY the enhanced prompt text. No preamble, no markdown code fence wrapping the whole reply, no commentary.",
    langRule,
    "6. Keep ALL placeholder tokens like [[AGY_CHIP_0]], [[AGY_CHIP_1]], etc. verbatim and in natural positions.",
    "7. Do NOT execute any tools, read files, or answer the prompt; ONLY rewrite the prompt itself.",
  ];

  const trimmedWs = effectiveSettings.includeWorkspaceContext ? String(workspaceContext || "").trim() : "";
  if (trimmedWs) {
    parts.push("", "WORKSPACE CONTEXT (active project):", trimmedWs);
  }

  const trimmedCtx = effectiveSettings.includeConversationContext ? String(context || "").trim() : "";
  if (trimmedCtx) {
    parts.push("", "CONVERSATION CONTEXT (most recent discussion):", trimmedCtx.slice(-6500));
  }

  parts.push("", "RAW PROMPT TO ENHANCE:", draft);
  return parts.join("\n");
}

function cleanOutput(text) {
  let out = String(text || "").trim();
  const fenceMatch = out.match(/^```(?:markdown|md|text)?\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenceMatch) out = fenceMatch[1].trim();
  return out;
}

function runEnhanceCli({ draft, context, model, cwd, settings }) {
  return new Promise((resolve, reject) => {
    const agyBin = findAgyCliBinary();
    if (!agyBin) {
      return reject(new Error("Native agy CLI binary not found in ~/.gemini/bin/agy.exe"));
    }

    const effectiveSettings = normalizeSettings(settings || readAllSettings());
    const resolvedModel = resolveDynamicModel(model);
    const workspaceContext = effectiveSettings.includeWorkspaceContext ? collectWorkspaceContext(cwd) : "";
    const convContext = effectiveSettings.includeConversationContext ? context : "";
    const strictSettings = JSON.stringify({
      toolPermission: "strict",
      permissions: {
        deny: [
          "command(*)",
          "read_file(*)",
          "write_file(*)",
          "read_url(*)",
          "execute_url(*)",
          "mcp(*)",
          "unsandboxed(*)",
        ],
      },
    });

    const baseArgs = [
      "--settings",
      strictSettings,
      "-p",
      buildEnhancePrompt(draft, convContext, workspaceContext, effectiveSettings),
      "--output-format",
      "text",
      "--disable-slash-commands",
    ];
    const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const start = Date.now();

    const execAttempt = (attemptModel, allowFallback) => {
      const args = attemptModel ? [...baseArgs, "--model", attemptModel] : [...baseArgs];
      execFile(
        agyBin,
        args,
        {
          cwd: workDir,
          timeout: resolveEnhanceTimeoutMs(),
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || stdout || err.message || "agy -p failed").trim();
            console.error(`[PromptEnhancer] agy -p failed (model=${attemptModel || "default"}):`, msg);
            if (allowFallback && attemptModel) {
              return execAttempt("", false);
            }
            return reject(new Error(msg.slice(0, 260)));
          }
          const enhanced = cleanOutput(stdout);
          if (!enhanced) {
            return reject(new Error("Empty response from model"));
          }
          resolve({
            enhanced,
            model: attemptModel || "default",
            durationMs: Date.now() - start,
          });
        }
      );
    };

    execAttempt(resolvedModel, Boolean(resolvedModel));
  });
}

function buildIframeHookSnippet(varName) {
  return (
    `${IFRAME_HOOK_MARKER}${varName}=((u)=>{try{` +
    `const p=require("path").join(__dirname,"..","..","..","out","vs","code","electron-browser","workbench","${HOOK_CONFIG_NAME}");` +
    `const cfg=JSON.parse(require("fs").readFileSync(p,"utf8"));` +
    `if(cfg&&cfg.port&&/^http:\\/\\/127\\.0\\.0\\.1:(\\d+)/.test(u)){` +
    `const x=new URL(u);x.searchParams.set("__agy_hub",x.port);x.port=String(cfg.port);return x.toString()` +
    `}}catch{}return u})(${varName});`
  );
}

function patchAgyExtensionContent(content) {
  if (!content || content.includes(IFRAME_HOOK_MARKER)) {
    return { changed: false, content };
  }

  const exactTarget = "renderIframe(a,b,c){var d=this.buildIframeUrl(b,c);";
  if (content.includes(exactTarget)) {
    return {
      changed: true,
      content: content.replace(exactTarget, exactTarget + buildIframeHookSnippet("d")),
    };
  }

  // Fallback for future minified variable renames across Antigravity IDE updates.
  const regexTarget = /(renderIframe\([^)]*\)\{\s*(?:var|let|const)\s+([a-zA-Z0-9_$]+)\s*=\s*this\.buildIframeUrl\([^;]+\);)/;
  const match = content.match(regexTarget);
  if (!match) {
    return { changed: false, content };
  }
  const matchedPrefix = match[1];
  const urlVar = match[2];
  return {
    changed: true,
    content: content.replace(matchedPrefix, matchedPrefix + buildIframeHookSnippet(urlVar)),
  };
}

const WORKBENCH_CHECKSUM_KEYS = [
  "vs/code/electron-browser/workbench/workbench.html",
  "vs/code/electron-browser/workbench/workbench-jetski-agent.html",
];

function computeFileChecksum(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncProductJsonChecksums(appRoot) {
  if (!appRoot) return { updated: false, updatedKeys: [] };
  const productJsonPath = path.join(appRoot, "product.json");
  if (!fs.existsSync(productJsonPath)) return { updated: false, updatedKeys: [] };

  let rawText;
  let parsed;
  try {
    rawText = fs.readFileSync(productJsonPath, "utf8");
    const cleanText = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
    parsed = JSON.parse(cleanText);
  } catch {
    return { updated: false, updatedKeys: [] };
  }

  if (!parsed || typeof parsed.checksums !== "object" || parsed.checksums === null) {
    return { updated: false, updatedKeys: [] };
  }

  const updates = [];
  for (const relKey of WORKBENCH_CHECKSUM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed.checksums, relKey)) continue;
    const diskPath = path.join(appRoot, "out", ...relKey.split("/"));
    if (!fs.existsSync(diskPath)) continue;
    const expected = parsed.checksums[relKey];
    const actual = computeFileChecksum(diskPath);
    if (expected !== actual) {
      updates.push({ relKey, expected, actual });
      parsed.checksums[relKey] = actual;
    }
  }

  if (updates.length === 0) {
    return { updated: false, updatedKeys: [] };
  }

  let nextText = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  let allReplacedSurgically = true;
  for (const u of updates) {
    const pattern = new RegExp(
      `("${escapeRegExp(u.relKey)}"\\s*:\\s*")${escapeRegExp(String(u.expected || ""))}(")`
    );
    if (pattern.test(nextText)) {
      nextText = nextText.replace(pattern, `$1${u.actual}$2`);
    } else {
      allReplacedSurgically = false;
      break;
    }
  }

  if (!allReplacedSurgically) {
    const trailingNl = nextText.endsWith("\r\n") ? "\r\n" : nextText.endsWith("\n") ? "\n" : "";
    nextText = JSON.stringify(parsed, null, "\t") + trailingNl;
  }

  fs.writeFileSync(productJsonPath, nextText, "utf8");
  return { updated: true, updatedKeys: updates.map((u) => u.relKey) };
}

function patchAgyExtensionIframe() {
  if (!vscode) return false;
  const agyExtJs = path.join(vscode.env.appRoot, "extensions", "agy", "vscode", "extension.js");
  if (!fs.existsSync(agyExtJs)) return false;
  const content = fs.readFileSync(agyExtJs, "utf8");
  const patched = patchAgyExtensionContent(content);
  if (!patched.changed) return false;

  const bakPath = `${agyExtJs}.enhancer.bak`;
  // Target is currently unpatched (fresh install or IDE update), so always refresh backup to match current version.
  fs.writeFileSync(bakPath, content, "utf8");

  fs.writeFileSync(agyExtJs, patched.content, "utf8");
  return true;
}

function ensureIdeHookInstalled(context, port, token, appRootOverride = "") {
  const appRoot = appRootOverride || (vscode && vscode.env && vscode.env.appRoot) || "";
  if (!appRoot) return { patched: false, hookUpdated: false, checksumsUpdated: false, reason: "appRoot unavailable" };
  const wbDir = path.join(appRoot, "out", "vs", "code", "electron-browser", "workbench");
  if (!fs.existsSync(wbDir)) return { patched: false, hookUpdated: false, checksumsUpdated: false, reason: "workbench dir not found" };

  const srcHook = path.join(context.extensionPath, HOOK_SCRIPT_NAME);
  const dstHook = path.join(wbDir, HOOK_SCRIPT_NAME);
  const srcBytes = fs.readFileSync(srcHook, "utf8");
  let hookUpdated = false;
  if (!fs.existsSync(dstHook) || fs.readFileSync(dstHook, "utf8") !== srcBytes) {
    fs.writeFileSync(dstHook, srcBytes, "utf8");
    hookUpdated = true;
  }

  const cfgPath = path.join(wbDir, HOOK_CONFIG_NAME);
  fs.writeFileSync(cfgPath, JSON.stringify({ port, token }), "utf8");

  const targets = [
    { file: "workbench.html", anchor: `<script src="./workbench.js" type="module"></script>` },
    { file: "workbench-jetski-agent.html", anchor: `<script src="./jetskiAgent.js" type="module"></script>` },
  ];

  let htmlPatched = false;
  for (const t of targets) {
    const htmlPath = path.join(wbDir, t.file);
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    if (html.includes(HOOK_SCRIPT_NAME)) continue;

    const bakPath = `${htmlPath}.enhancer.bak`;
    // Target HTML does not contain our hook yet, so save exact current version as clean backup.
    fs.writeFileSync(bakPath, html, "utf8");
    const nextHtml = html.includes(t.anchor)
      ? html.replace(t.anchor, `${t.anchor}\n${SCRIPT_TAG}`)
      : html.replace("</html>", `${SCRIPT_TAG}\n</html>`);
    fs.writeFileSync(htmlPath, nextHtml, "utf8");
    htmlPatched = true;
  }

  let checksumsUpdated = false;
  try {
    const cs = syncProductJsonChecksums(appRoot);
    checksumsUpdated = Boolean(cs && cs.updated);
  } catch (err) {
    console.error("[PromptEnhancer] Failed to sync product.json checksums:", err);
  }

  const iframePatched = appRootOverride ? false : patchAgyExtensionIframe();

  return { patched: htmlPatched || iframePatched, hookUpdated, checksumsUpdated };
}

function parsePortCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return 0;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${HUB_COOKIE_NAME}=(\\d{1,5})(?:;|$)`));
  if (!m) return 0;
  const p = Number(m[1]);
  return p > 0 && p < 65536 ? p : 0;
}

function parseRefererHubPort(refererHeader) {
  if (!refererHeader || typeof refererHeader !== "string") return 0;
  try {
    const refUrl = new URL(refererHeader);
    const p = Number(refUrl.searchParams.get("__agy_hub") || 0);
    return p > 0 && p < 65536 ? p : 0;
  } catch {
    return 0;
  }
}

function resolveHubTarget(rawUrl, headersOrFallback = {}, fallbackPort = 0) {
  let headers = {};
  let fallback = fallbackPort;
  if (typeof headersOrFallback === "number") {
    fallback = headersOrFallback;
  } else if (headersOrFallback && typeof headersOrFallback === "object") {
    headers = headersOrFallback;
  }

  try {
    const u = new URL(rawUrl || "/", "http://127.0.0.1");
    const qPort = Number(u.searchParams.get("__agy_hub") || 0);
    if (qPort > 0 && qPort < 65536) {
      u.searchParams.delete("__agy_hub");
      return { hubPort: qPort, forwardPath: u.pathname + u.search, fromQuery: true };
    }
    const refPort = parseRefererHubPort(headers.referer || headers.Referer);
    if (refPort > 0) {
      return { hubPort: refPort, forwardPath: u.pathname + u.search, fromQuery: false };
    }
    const cookiePort = parsePortCookie(headers.cookie || headers.Cookie);
    if (cookiePort > 0) {
      return { hubPort: cookiePort, forwardPath: u.pathname + u.search, fromQuery: false };
    }
    return { hubPort: fallback, forwardPath: u.pathname + u.search, fromQuery: false };
  } catch {
    return { hubPort: fallback, forwardPath: rawUrl || "/", fromQuery: false };
  }
}

function injectHookIntoHtml(html) {
  const injectTag = `<script type="module" src="/__enhancer/hook.js"></script>`;
  if (html.includes(injectTag)) return html;
  if (html.includes("</body>")) return html.replace("</body>", `${injectTag}\n</body>`);
  if (html.includes("</html>")) return html.replace("</html>", `${injectTag}\n</html>`);
  return html + injectTag;
}

function isAllowedEnhancerOrigin(origin, serverPort) {
  if (!origin || typeof origin !== "string") return true;
  const trimmed = origin.trim();
  if (!trimmed) return true;
  if (serverPort > 0 && (trimmed === `http://127.0.0.1:${serverPort}` || trimmed === `http://localhost:${serverPort}`)) {
    return true;
  }
  if (/^vscode-file:\/\/[a-zA-Z0-9._-]+$/i.test(trimmed)) return true;
  if (/^vscode-webview:\/\/[a-zA-Z0-9._-]+$/i.test(trimmed)) return true;
  return false;
}

function isAllowedEnhancerRequest(req, serverPort) {
  const headers = (req && req.headers) || {};
  const sfs = String(headers["sec-fetch-site"] || "").toLowerCase();
  if (sfs === "cross-site") return false;

  const origin = headers.origin || headers.Origin || "";
  if (origin && !isAllowedEnhancerOrigin(origin, serverPort)) return false;

  const referer = headers.referer || headers.Referer || "";
  if (referer) {
    if (/^vscode-(?:file|webview):\/\//i.test(referer)) {
      return true;
    }
    try {
      const u = new URL(referer);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return isAllowedEnhancerOrigin(u.origin, serverPort);
      }
      return false;
    } catch {
      return false;
    }
  }

  return true;
}

function applyEnhancerCorsHeaders(req, res, serverPort) {
  const origin = (req && req.headers && (req.headers.origin || req.headers.Origin)) || "";
  if (origin && isAllowedEnhancerOrigin(origin, serverPort)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Enhancer-Token");
  }
}

function activate(context) {
  const extId = (context && context.extension && context.extension.id) || "kyuzan0.ag-ide-prompt-enhancer";
  const token = crypto.randomBytes(16).toString("hex");
  let serverPort = 0;
  let lastHubPort = 0;

  const handleEnhancePost = (req, res) => {
    if (!isAllowedEnhancerRequest(req, serverPort)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }
    applyEnhancerCorsHeaders(req, res, serverPort);
    if (req.headers["x-enhancer-token"] !== token) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const { draft, context: convContext, model } = JSON.parse(body || "{}");
        if (!draft || !String(draft).trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Empty draft" }));
          return;
        }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || os.homedir();
        const result = await runEnhanceCli({
          draft: String(draft),
          context: convContext ? String(convContext) : "",
          model,
          cwd,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
  };

  const sseClients = new Set();
  const broadcastSse = (eventName, payload) => {
    const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload || {})}\n\n`;
    for (const clientRes of sseClients) {
      try {
        clientRes.write(msg);
      } catch {
        sseClients.delete(clientRes);
      }
    }
  };

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      const origin = req.headers.origin || req.headers.Origin || "";
      if (origin && !isAllowedEnhancerOrigin(origin, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      const optHeaders = {
        "Access-Control-Allow-Headers": "Content-Type, X-Enhancer-Token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      };
      if (origin) {
        optHeaders["Access-Control-Allow-Origin"] = origin;
        optHeaders["Vary"] = "Origin";
      }
      res.writeHead(204, optHeaders);
      res.end();
      return;
    }

    const reqPath = (req.url || "/").split("?")[0];

    if (req.method === "GET" && reqPath === "/__enhancer/events") {
      if (!isAllowedEnhancerRequest(req, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
        Connection: "keep-alive",
      });
      res.write(`event: settings\ndata: ${JSON.stringify(readAllSettings())}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method === "GET" && reqPath === "/__enhancer/settings") {
      if (!isAllowedEnhancerRequest(req, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      applyEnhancerCorsHeaders(req, res, serverPort);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      res.end(JSON.stringify({ ok: true, settings: readAllSettings() }));
      return;
    }

    if (req.method === "POST" && reqPath === "/__enhancer/settings") {
      if (!isAllowedEnhancerRequest(req, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      applyEnhancerCorsHeaders(req, res, serverPort);
      if (req.headers["x-enhancer-token"] !== token) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on("end", async () => {
        try {
          const patch = JSON.parse(body || "{}");
          const saved = await saveSettingsPatch(patch);
          broadcastSse("settings", saved);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, settings: saved }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
        }
      });
      return;
    }

    if (req.method === "POST" && reqPath === "/__enhancer/open-vscode-settings") {
      if (!isAllowedEnhancerRequest(req, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      applyEnhancerCorsHeaders(req, res, serverPort);
      if (req.headers["x-enhancer-token"] !== token) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      if (vscode) {
        vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${extId}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && reqPath === "/__enhancer/client-log") {
      if (!isAllowedEnhancerRequest(req, serverPort) || req.headers["x-enhancer-token"] !== token) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      applyEnhancerCorsHeaders(req, res, serverPort);
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 32768) req.destroy(); });
      req.on("end", () => {
        console.error("[PromptEnhancer][Client]", body.slice(0, 1000));
        res.writeHead(204);
        res.end();
      });
      return;
    }

    if (req.method === "POST" && (reqPath === "/enhance" || reqPath === "/__enhancer/enhance")) {
      handleEnhancePost(req, res);
      return;
    }

    if (req.method === "GET" && reqPath === "/__enhancer/config.json") {
      if (!isAllowedEnhancerRequest(req, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      res.end(JSON.stringify({ port: serverPort, token, settings: readAllSettings() }));
      return;
    }

    if (req.method === "GET" && reqPath === "/__enhancer/hook.js") {
      if (!isAllowedEnhancerRequest(req, serverPort)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
        return;
      }
      try {
        const hookPath = path.join(context.extensionPath, HOOK_SCRIPT_NAME);
        const hookBody = fs.readFileSync(hookPath, "utf8");
        const prefix = `window.__AGY_ENHANCER_CONFIG__ = ${JSON.stringify({
          port: serverPort,
          token,
          settings: readAllSettings(),
        })};\n`;
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(prefix + hookBody);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(err?.message || "Failed to load hook.js");
      }
      return;
    }

    const { hubPort, forwardPath, fromQuery } = resolveHubTarget(req.url, req.headers, lastHubPort);
    if (hubPort > 0) lastHubPort = hubPort;
    if (!hubPort) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Antigravity hub port not yet known");
      return;
    }

    const headers = { ...req.headers, host: `127.0.0.1:${hubPort}` };
    delete headers["accept-encoding"];

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: hubPort,
        path: forwardPath,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const contentType = String(proxyRes.headers["content-type"] || "");
        if (contentType.includes("text/html")) {
          const chunks = [];
          proxyRes.on("data", (c) => chunks.push(c));
          proxyRes.on("end", () => {
            const html = injectHookIntoHtml(Buffer.concat(chunks).toString("utf8"));
            const outHeaders = { ...proxyRes.headers };
            delete outHeaders["content-length"];
            if (fromQuery) {
              const cookieVal = `${HUB_COOKIE_NAME}=${hubPort}; Path=/; SameSite=Lax`;
              const prevSetCookie = outHeaders["set-cookie"];
              outHeaders["set-cookie"] = Array.isArray(prevSetCookie)
                ? [...prevSetCookie, cookieVal]
                : prevSetCookie
                  ? [prevSetCookie, cookieVal]
                  : [cookieVal];
            }
            res.writeHead(proxyRes.statusCode || 200, outHeaders);
            res.end(html);
          });
        } else {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      }
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
      }
      res.end(`Hub proxy error: ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  server.on("upgrade", (req, clientSocket, head) => {
    const { hubPort, forwardPath } = resolveHubTarget(req.url, req.headers, lastHubPort);
    if (hubPort > 0) lastHubPort = hubPort;
    if (!hubPort) {
      clientSocket.destroy();
      return;
    }

    const upstream = net.connect({ host: "127.0.0.1", port: hubPort }, () => {
      let raw = `${req.method} ${forwardPath} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        let v = req.rawHeaders[i + 1];
        const lk = k.toLowerCase();
        if (lk === "host") v = `127.0.0.1:${hubPort}`;
        else if (lk === "origin") v = `http://127.0.0.1:${hubPort}`;
        raw += `${k}: ${v}\r\n`;
      }
      raw += "\r\n";
      upstream.write(raw);
      if (head && head.length) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });

    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });

  const onListening = () => {
    const addr = server.address();
    serverPort = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const status = ensureIdeHookInstalled(context, serverPort, token);
      if (status.patched) {
        vscode.window
          .showInformationMessage(
            "Antigravity IDE Prompt Enhancer hook restored after IDE update. Reload window to show the Enhance button.",
            "Reload Window"
          )
          .then((choice) => {
            if (choice === "Reload Window") {
              vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
      }
    } catch (err) {
      console.error("[PromptEnhancer] Failed to ensure IDE hook:", err);
    }
  };

  server.once("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      server.listen(0, "127.0.0.1", onListening);
    }
  });
  server.listen(resolvePreferredPort(), "127.0.0.1", onListening);

  context.subscriptions.push(
    {
      dispose: () => {
        for (const clientRes of sseClients) {
          try {
            clientRes.end();
          } catch {
            // ignore
          }
        }
        sseClients.clear();
        server.close();
      },
    },
    vscode.commands.registerCommand("antigravityEnhancer.enhancePrompt", () => {
      if (sseClients.size > 0) {
        broadcastSse("enhance", { source: "command" });
      } else {
        vscode.window.showInformationMessage(
          "Open the Antigravity chat panel with an active draft prompt to run Enhance Prompt."
        );
      }
    }),
    vscode.commands.registerCommand("antigravityEnhancer.openSettings", () => {
      if (sseClients.size > 0) {
        broadcastSse("open-settings", {});
      } else {
        const extId = (context && context.extension && context.extension.id) || "kyuzan0.ag-ide-prompt-enhancer";
        vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${extId}`);
      }
    }),
    vscode.commands.registerCommand("antigravityEnhancer.reinstallHook", () => {
      const status = ensureIdeHookInstalled(context, serverPort, token);
      vscode.window.showInformationMessage(
        status.patched || status.checksumsUpdated
          ? "Prompt Enhancer IDE hook and checksums updated. Please reload window."
          : "Prompt Enhancer IDE hook is already up to date."
      );
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("antigravityPromptEnhancer")) {
        broadcastSse("settings", readAllSettings());
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  DEFAULT_SETTINGS,
  normalizeShortcut,
  normalizeSettings,
  readAllSettings,
  saveSettingsPatch,
  resolveDynamicModel,
  resolvePreferredPort,
  resolveEnhanceTimeoutMs,
  findAgyCliBinary,
  collectWorkspaceContext,
  buildEnhancePrompt,
  resolveHubTarget,
  injectHookIntoHtml,
  patchAgyExtensionContent,
  computeFileChecksum,
  syncProductJsonChecksums,
  ensureIdeHookInstalled,
  isAllowedEnhancerOrigin,
  isAllowedEnhancerRequest,
};
