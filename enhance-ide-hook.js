// Antigravity IDE UI Hook for Enhance Prompt button.
// Trusted-Types safe: uses DOM APIs only (no innerHTML / eval).
(function () {
  if (window.__agyEnhanceIdeHookLoaded) return;
  window.__agyEnhanceIdeHookLoaded = true;

  const CHIP_TOKEN_PREFIX = "[[AGY_CHIP_";
  const CHIP_TOKEN_SUFFIX = "]]";
  const DEFAULT_UI_SETTINGS = {
    shortcutEnabled: true,
    shortcut: "Ctrl+Alt+E",
    outputLanguage: "auto",
    detailLevel: "balanced",
    includeWorkspaceContext: true,
    includeConversationContext: true,
    showToast: true,
  };
  let cachedConfig = null;
  let currentSettings = { ...DEFAULT_UI_SETTINGS };
  let isRecordingShortcut = false;
  let activePopoverEl = null;
  let toastTimer = null;
  let toastEl = null;
  let styleInjected = false;

  if (window.__AGY_ENHANCER_CONFIG__ && window.__AGY_ENHANCER_CONFIG__.settings) {
    currentSettings = { ...DEFAULT_UI_SETTINGS, ...window.__AGY_ENHANCER_CONFIG__.settings };
  }

  function ensureStyle() {
    if (styleInjected || !document.head) return;
    styleInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      @keyframes agyEnhanceSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .agy-enhance-group {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        flex-shrink: 0;
      }
      .agy-enhance-btn, .agy-settings-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 4px;
        border-radius: 9999px;
        border: none;
        background: transparent;
        color: var(--vscode-foreground, #cccccc);
        opacity: 0.72;
        cursor: pointer;
        transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
      }
      .agy-settings-btn {
        width: 22px;
        height: 22px;
        opacity: 0.5;
      }
      .agy-enhance-btn:hover:not(:disabled), .agy-settings-btn:hover {
        opacity: 1;
        background-color: rgba(128, 128, 128, 0.18);
      }
      .agy-enhance-btn:disabled {
        opacity: 0.32;
        cursor: not-allowed;
      }
      .agy-enhance-btn.agy-enhancing svg {
        animation: agyEnhanceSpin 1.1s linear infinite;
        color: #facc15;
      }
      .agy-enhance-btn.agy-error {
        color: #f87171;
        opacity: 1;
      }
      .agy-settings-popover {
        position: fixed;
        z-index: 99999;
        width: 286px;
        padding: 12px;
        border-radius: 8px;
        background: var(--vscode-editorWidget-background, #1f2228);
        color: var(--vscode-foreground, #e5e7eb);
        border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.14));
        box-shadow: 0 10px 28px rgba(0,0,0,0.42);
        font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
        font-size: 12px;
        line-height: 1.4;
      }
      .agy-sp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(128,128,128,0.22);
        font-weight: 600;
        font-size: 12px;
      }
      .agy-sp-status {
        font-weight: 400;
        font-size: 11px;
        color: #4ade80;
      }
      .agy-sp-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .agy-sp-row label {
        flex: 1;
        cursor: pointer;
        user-select: none;
      }
      .agy-sp-select, .agy-sp-shortcut-input {
        background: var(--vscode-input-background, #14161a);
        color: var(--vscode-input-foreground, #e5e7eb);
        border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.18));
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 11px;
        outline: none;
      }
      .agy-sp-shortcut-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .agy-sp-shortcut-input {
        width: 112px;
        text-align: center;
        cursor: pointer;
      }
      .agy-sp-shortcut-input:focus {
        border-color: #60a5fa;
      }
      .agy-sp-mini-btn {
        background: rgba(128,128,128,0.18);
        color: inherit;
        border: none;
        border-radius: 4px;
        padding: 3px 7px;
        font-size: 11px;
        cursor: pointer;
      }
      .agy-sp-mini-btn:hover {
        background: rgba(128,128,128,0.3);
      }
      .agy-sp-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(128,128,128,0.22);
      }
      .agy-sp-hint {
        font-size: 10px;
        opacity: 0.72;
        margin: -4px 0 8px 0;
      }
      .agy-toast-pill {
        position: fixed;
        z-index: 99998;
        padding: 5px 10px;
        border-radius: 9999px;
        background: var(--vscode-editorWidget-background, #1f2228);
        color: var(--vscode-foreground, #e5e7eb);
        border: 1px solid rgba(128,128,128,0.3);
        box-shadow: 0 4px 14px rgba(0,0,0,0.32);
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: 11px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.18s ease;
      }
      .agy-toast-pill.visible {
        opacity: 0.96;
      }
      .agy-toast-pill.error {
        border-color: rgba(248,113,113,0.6);
        color: #fca5a5;
      }
    `;
    document.head.appendChild(style);
  }

  function createGearSvg() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "3");
    const pathEl = document.createElementNS(ns, "path");
    pathEl.setAttribute("d", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z");
    svg.appendChild(circle);
    svg.appendChild(pathEl);
    return svg;
  }

  function parseShortcut(str) {
    const tokens = String(str || DEFAULT_UI_SETTINGS.shortcut)
      .split("+")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const parsed = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
    for (const t of tokens) {
      if (t === "ctrl" || t === "control") parsed.ctrl = true;
      else if (t === "alt" || t === "option") parsed.alt = true;
      else if (t === "shift") parsed.shift = true;
      else if (t === "cmd" || t === "meta" || t === "super" || t === "win") parsed.meta = true;
      else parsed.key = t;
    }
    return parsed;
  }

  const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

  function matchesShortcutEvent(e, shortcutStr) {
    const spec = parseShortcut(shortcutStr);
    if (!spec.key || (!spec.ctrl && !spec.alt && !spec.shift && !spec.meta)) return false;
    const pressedKey = String(e.key || "").toLowerCase();
    const codeKey = String(e.code || "").toLowerCase();
    const keyMatch =
      pressedKey === spec.key ||
      (spec.key.length === 1 && codeKey === `key${spec.key}`) ||
      (spec.key === "space" && pressedKey === " ");
    if (
      keyMatch &&
      Boolean(e.ctrlKey) === spec.ctrl &&
      Boolean(e.altKey) === spec.alt &&
      Boolean(e.shiftKey) === spec.shift &&
      Boolean(e.metaKey) === spec.meta
    ) {
      return true;
    }
    if (
      IS_MAC &&
      String(shortcutStr || "").trim().toLowerCase() === "ctrl+alt+e" &&
      keyMatch &&
      !e.ctrlKey &&
      Boolean(e.altKey) &&
      !e.shiftKey &&
      Boolean(e.metaKey)
    ) {
      return true;
    }
    return false;
  }

  function formatShortcutFromEvent(e) {
    const rawKey = String(e.key || "");
    const low = rawKey.toLowerCase();
    if (["control", "alt", "shift", "meta", "os"].includes(low)) return "";
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return "";
    const out = [];
    if (e.ctrlKey) out.push("Ctrl");
    if (e.altKey) out.push("Alt");
    if (e.shiftKey) out.push("Shift");
    if (e.metaKey) out.push("Cmd");
    let keyLabel = rawKey;
    if (keyLabel === " ") keyLabel = "Space";
    else if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();
    else keyLabel = keyLabel[0].toUpperCase() + keyLabel.slice(1);
    out.push(keyLabel);
    return out.join("+");
  }

  function formatEnhanceTooltip() {
    if (currentSettings.shortcutEnabled && currentSettings.shortcut) {
      return `Enhance Prompt (${currentSettings.shortcut})`;
    }
    return "Enhance Prompt";
  }

  function refreshAllTooltips() {
    const btns = document.querySelectorAll('[data-testid="enhance-prompt-button"]');
    const tip = formatEnhanceTooltip();
    for (const b of btns) {
      if (!b.classList.contains("agy-enhancing") && !b.classList.contains("agy-error")) {
        b.title = tip;
      }
    }
  }

  function showToast(anchorEl, text, isError) {
    if (!currentSettings.showToast || !document.body) return;
    ensureStyle();
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "agy-toast-pill";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.className = isError ? "agy-toast-pill error visible" : "agy-toast-pill visible";
    if (anchorEl && anchorEl.getBoundingClientRect) {
      const rect = anchorEl.getBoundingClientRect();
      toastEl.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
      toastEl.style.bottom = `${Math.max(48, window.innerHeight - rect.top + 8)}px`;
    } else {
      toastEl.style.right = "16px";
      toastEl.style.bottom = "56px";
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.classList.remove("visible");
    }, 2800);
  }

  function createSparkleSvg() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const p1 = document.createElementNS(ns, "path");
    p1.setAttribute("d", "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z");
    const p2 = document.createElementNS(ns, "path");
    p2.setAttribute("d", "M20 3v4");
    const p3 = document.createElementNS(ns, "path");
    p3.setAttribute("d", "M22 5h-4");
    svg.appendChild(p1);
    svg.appendChild(p2);
    svg.appendChild(p3);
    return svg;
  }

  async function loadConfig(forceReload) {
    if (cachedConfig && !forceReload) return cachedConfig;
    if (!forceReload && window.__AGY_ENHANCER_CONFIG__ && window.__AGY_ENHANCER_CONFIG__.port && window.__AGY_ENHANCER_CONFIG__.token) {
      cachedConfig = window.__AGY_ENHANCER_CONFIG__;
      return cachedConfig;
    }
    const cfgUrl = window.location.protocol.startsWith("http")
      ? "/__enhancer/config.json"
      : "./enhance-ide-hook-config.json";
    const resp = await fetch(cfgUrl, { cache: "no-store" });
    if (!resp.ok) throw new Error("Enhancer backend config not ready");
    const cfg = await resp.json();
    if (!cfg || !cfg.port || !cfg.token) throw new Error("Invalid enhancer config");
    cachedConfig = cfg;
    return cfg;
  }

  function serializeLexicalState(stateJson) {
    const chips = [];
    const lines = [];
    const rootChildren = (stateJson && stateJson.root && Array.isArray(stateJson.root.children))
      ? stateJson.root.children
      : [];
    for (const para of rootChildren) {
      let line = "";
      const children = Array.isArray(para.children) ? para.children : [];
      for (const node of children) {
        if (node.type === "text") {
          line += node.text || "";
        } else if (node.type === "linebreak") {
          line += "\n";
        } else if (node.type === "tab") {
          line += "\t";
        } else {
          const idx = chips.length;
          chips.push(node);
          line += CHIP_TOKEN_PREFIX + idx + CHIP_TOKEN_SUFFIX;
        }
      }
      lines.push(line);
    }
    return {
      text: lines.join("\n"),
      chips,
      markers: chips.map((_, i) => CHIP_TOKEN_PREFIX + i + CHIP_TOKEN_SUFFIX),
    };
  }

  function findTemplateNodes(stateJson) {
    let paraTpl = null;
    let textTpl = null;
    const rootChildren = stateJson && stateJson.root && Array.isArray(stateJson.root.children)
      ? stateJson.root.children
      : [];
    for (const p of rootChildren) {
      if (!paraTpl && p && Array.isArray(p.children)) {
        paraTpl = { ...p, children: [] };
      }
      if (!textTpl && p && Array.isArray(p.children)) {
        for (const c of p.children) {
          if (c && c.type === "text") {
            textTpl = { ...c };
            break;
          }
        }
      }
    }
    return { paraTpl, textTpl };
  }

  function makeTextNode(text, textTpl) {
    if (textTpl) return { ...textTpl, text };
    return { detail: 0, format: 0, mode: "normal", style: "", text, type: "text", version: 1 };
  }

  function makeParagraphNode(children, paraTpl) {
    if (paraTpl) return { ...paraTpl, children };
    return {
      children,
      direction: "ltr",
      format: "",
      indent: 0,
      textFormat: 0,
      textStyle: "",
      type: "paragraph",
      version: 1,
    };
  }

  function deserializeToLexicalJson(enhancedText, chips, stateJson) {
    const { paraTpl, textTpl } = findTemplateNodes(stateJson);
    const usedChips = new Set();
    const tokenRe = /\[\[AGY_CHIP_(\d+)\]\]/g;
    const rawLines = String(enhancedText || "").replace(/\r\n/g, "\n").split("\n");
    const paragraphs = rawLines.map((line) => {
      const children = [];
      let lastIndex = 0;
      tokenRe.lastIndex = 0;
      let match;
      while ((match = tokenRe.exec(line)) !== null) {
        if (match.index > lastIndex) {
          children.push(makeTextNode(line.slice(lastIndex, match.index), textTpl));
        }
        const chipIdx = Number(match[1]);
        if (Number.isInteger(chipIdx) && chipIdx >= 0 && chipIdx < chips.length) {
          children.push(chips[chipIdx]);
          usedChips.add(chipIdx);
        }
        lastIndex = tokenRe.lastIndex;
      }
      if (lastIndex < line.length) {
        children.push(makeTextNode(line.slice(lastIndex), textTpl));
      }
      return makeParagraphNode(children, paraTpl);
    });

    // Guarantee any chip omitted by the model is preserved at the end.
    const missing = [];
    for (let i = 0; i < chips.length; i++) {
      if (!usedChips.has(i)) missing.push(chips[i]);
    }
    if (missing.length > 0) {
      const lastPara = paragraphs[paragraphs.length - 1] || makeParagraphNode([], paraTpl);
      if (lastPara.children.length > 0) lastPara.children.push(makeTextNode(" ", textTpl));
      for (const chip of missing) {
        lastPara.children.push(chip, makeTextNode(" ", textTpl));
      }
      if (paragraphs.length === 0) paragraphs.push(lastPara);
    }

    const rootBase = stateJson && stateJson.root ? { ...stateJson.root } : {
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    };
    rootBase.children = paragraphs;
    return { root: rootBase };
  }

  function formatChipFallbackText(chip) {
    if (!chip) return "";
    return chip.mentionName || chip.text || chip.label || chip.path || chip.uri || "";
  }

  function logClientDiag(payload) {
    try {
      const tok =
        (cachedConfig && cachedConfig.token) ||
        (window.__AGY_ENHANCER_CONFIG__ && window.__AGY_ENHANCER_CONFIG__.token) ||
        "";
      if (!tok) return;
      const url = window.location.protocol.startsWith("http")
        ? "/__enhancer/client-log"
        : (cachedConfig ? `http://127.0.0.1:${cachedConfig.port}/__enhancer/client-log` : "");
      if (!url) return;
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Enhancer-Token": tok,
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function replaceInputViaDom(inputEl, enhancedText, chips) {
    let plain = String(enhancedText || "");
    plain = plain.replace(/\[\[AGY_CHIP_(\d+)\]\]/g, (_, idxStr) => {
      const idx = Number(idxStr);
      return Number.isInteger(idx) && chips[idx] ? formatChipFallbackText(chips[idx]) : "";
    });

    inputEl.focus();
    // Clear existing draft cleanly so Lexical's internal selection syncs before insertion.
    document.execCommand("selectAll", false, null);
    await sleep(25);
    document.execCommand("delete", false, null);
    await sleep(20);

    if ((inputEl.textContent || "").trim().length > 0) {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(inputEl);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      await sleep(20);
      document.execCommand("delete", false, null);
      await sleep(15);
    }

    // 1. Lexical native paste handler via ClipboardEvent + DataTransfer (insert once)
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", plain);
      inputEl.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }));
      await sleep(30);
      if ((inputEl.textContent || "").trim().length > 0) return true;
    } catch {
      // ignore
    }

    // 2. Lexical beforeinput handler (insertFromPaste), only if paste produced nothing
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", plain);
      inputEl.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
        dataTransfer: dt,
      }));
      await sleep(30);
      if ((inputEl.textContent || "").trim().length > 0) return true;
    } catch {
      // ignore
    }

    // 3. Final fallback: execCommand selectAll + insertText
    document.execCommand("selectAll", false, null);
    await sleep(15);
    return document.execCommand("insertText", false, plain);
  }

  function detectDisplayedModel(inputBox) {
    // Check leaf spans first so nested badges don't concatenate duplicate text.
    for (const selector of ["span", "button, [role='button']"]) {
      const candidates = inputBox.querySelectorAll(selector);
      for (const el of candidates) {
        const txt = (el.textContent || "").trim();
        if (/^(Gemini|Claude|Orchestrator|GPT-OSS)\b/i.test(txt) && txt.length < 60) {
          return txt;
        }
      }
    }
    return "";
  }

  function findConversationRoot(inputBox) {
    let cur = inputBox.parentElement;
    for (let i = 0; i < 10 && cur && cur !== document.body; i++) {
      if (
        cur.querySelector('[data-testid="user-message-content"], [data-testid="user-input-step"]')
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return inputBox.closest('[data-testid="conversation-view-drag-tint"]') || document.body;
  }

  function extractConversationContext(inputBox) {
    try {
      const root = findConversationRoot(inputBox);
      const userMsgs = Array.from(root.querySelectorAll('[data-testid="user-message-content"]'));
      let listContainer = null;
      if (userMsgs.length > 0) {
        const lastUserStep =
          userMsgs[userMsgs.length - 1].closest('[data-testid="user-input-step"]') ||
          userMsgs[userMsgs.length - 1];
        listContainer = lastUserStep.parentElement;
        while (
          listContainer &&
          listContainer.parentElement &&
          listContainer.parentElement !== root &&
          listContainer.children.length < 2
        ) {
          listContainer = listContainer.parentElement;
        }
      }
      if (!listContainer) {
        const clone = root.cloneNode(true);
        const cloneInput = clone.querySelector('[data-testid="agent-input-box"]');
        if (cloneInput) cloneInput.remove();
        const raw = (clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
        return raw.slice(-6000);
      }

      const turns = [];
      for (const child of Array.from(listContainer.children)) {
        if (child.contains(inputBox) || inputBox.contains(child)) continue;
        const userEl = child.querySelector('[data-testid="user-message-content"]');
        if (userEl) {
          const txt = (userEl.innerText || userEl.textContent || "").trim();
          if (txt) turns.push(`USER:\n${txt}`);
          continue;
        }
        const raw = (child.innerText || child.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
        if (raw && raw.length > 2) {
          turns.push(`ASSISTANT:\n${raw.length > 1800 ? raw.slice(0, 900) + "\n...\n" + raw.slice(-800) : raw}`);
        }
      }

      const selected = [];
      let total = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        if (total + t.length > 6000 && selected.length > 0) break;
        selected.unshift(t);
        total += t.length;
      }
      return selected.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  async function callEnhanceBackend(payload) {
    let cfg = await loadConfig(false);
    const doFetch = async (c) => {
      const url = window.location.protocol.startsWith("http")
        ? "/__enhancer/enhance"
        : `http://127.0.0.1:${c.port}/__enhancer/enhance`;
      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Enhancer-Token": c.token,
        },
        body: JSON.stringify(payload),
      });
    };

    let resp;
    try {
      resp = await doFetch(cfg);
    } catch {
      // Port may have rotated on extension reload; reload config once.
      cfg = await loadConfig(true);
      resp = await doFetch(cfg);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data;
  }

  function syncButtonDisabled(btn, inputEl) {
    if (btn.classList.contains("agy-enhancing")) return;
    const editor = inputEl && inputEl.__lexicalEditor;
    let isEmpty = false;
    if (editor) {
      editor.getEditorState().read(() => {
        const json = editor.getEditorState().toJSON();
        const { text, chips } = serializeLexicalState(json);
        isEmpty = !text.trim() && chips.length === 0;
      });
    } else {
      isEmpty = !(inputEl && inputEl.textContent && inputEl.textContent.trim());
    }
    btn.disabled = isEmpty;
  }

  async function handleEnhanceClick(btn, inputBox, inputEl) {
    if (!inputEl || btn.classList.contains("agy-enhancing")) return;
    const editor = inputEl.__lexicalEditor;

    let stateJson = null;
    let text = "";
    let chips = [];
    let markers = [];
    if (editor) {
      stateJson = editor.getEditorState().toJSON();
      ({ text, chips, markers } = serializeLexicalState(stateJson));
    } else {
      text = inputEl.innerText || inputEl.textContent || "";
    }
    if (!text.trim()) return;

    btn.classList.remove("agy-error");
    btn.classList.add("agy-enhancing");
    btn.disabled = true;
    btn.title = "Enhancing prompt...";

    try {
      const model = detectDisplayedModel(inputBox);
      const context = extractConversationContext(inputBox);
      const res = await callEnhanceBackend({ draft: text, context, model, markers });
      if (res.enhanced && res.enhanced.trim() && res.enhanced !== text) {
        let applied = false;
        if (editor && stateJson && typeof editor.parseEditorState === "function") {
          const nextJson = deserializeToLexicalJson(res.enhanced, chips, stateJson);
          try {
            const parsed = editor.parseEditorState(JSON.stringify(nextJson));
            editor.setEditorState(parsed);
            editor.focus();
            applied = true;
          } catch (parseErr) {
            console.warn("[EnhanceHook] parseEditorState failed, using DOM fallback:", parseErr);
            logClientDiag({
              event: "parseEditorState_failed",
              error: parseErr && parseErr.message ? parseErr.message : String(parseErr),
              rootType: stateJson && stateJson.root && stateJson.root.type,
              childTypes: (stateJson && stateJson.root && Array.isArray(stateJson.root.children)
                ? stateJson.root.children.map((c) => c && c.type)
                : []),
            });
          }
        }
        if (!applied) {
          const domOk = await replaceInputViaDom(inputEl, res.enhanced, chips);
          logClientDiag({
            event: "dom_fallback",
            ok: Boolean(domOk),
            len: res.enhanced.length,
            ctxLen: context.length,
            modelSent: model,
            modelUsed: res.model,
          });
        }
        btn.title = `Enhanced (${res.model || "active model"})`;
        showToast(btn, `✦ Enhanced (${res.model || "active model"})`, false);
      } else {
        btn.title = "No changes suggested";
        showToast(btn, "No changes suggested", false);
      }
    } catch (err) {
      console.error("[EnhanceHook] Enhance failed:", err);
      btn.classList.add("agy-error");
      const errMsg = err && err.message ? err.message : String(err);
      btn.title = `Enhance failed: ${errMsg}`;
      showToast(btn, `Enhance failed: ${errMsg.slice(0, 80)}`, true);
      setTimeout(() => {
        btn.classList.remove("agy-error");
        refreshAllTooltips();
      }, 4000);
    } finally {
      btn.classList.remove("agy-enhancing");
      syncButtonDisabled(btn, inputEl);
    }
  }

  async function saveSettingsPatch(patch, statusEl) {
    try {
      const cfg = await loadConfig(false);
      const url = window.location.protocol.startsWith("http")
        ? "/__enhancer/settings"
        : `http://127.0.0.1:${cfg.port}/__enhancer/settings`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Enhancer-Token": cfg.token,
        },
        body: JSON.stringify(patch),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok && data.settings) {
        currentSettings = { ...DEFAULT_UI_SETTINGS, ...data.settings };
        refreshAllTooltips();
        if (statusEl) {
          statusEl.textContent = "Saved";
          setTimeout(() => {
            if (statusEl) statusEl.textContent = "";
          }, 1500);
        }
        return currentSettings;
      }
    } catch (err) {
      console.warn("[EnhanceHook] Failed to save settings:", err);
      if (statusEl) statusEl.textContent = "Save error";
    }
    return currentSettings;
  }

  function closeSettingsPopover() {
    isRecordingShortcut = false;
    if (activePopoverEl && activePopoverEl.parentNode) {
      activePopoverEl.parentNode.removeChild(activePopoverEl);
    }
    activePopoverEl = null;
  }

  function buildCheckboxRow(labelText, key, statusEl) {
    const row = document.createElement("div");
    row.className = "agy-sp-row";
    const id = `agy-sp-${key}`;
    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = Boolean(currentSettings[key]);
    input.addEventListener("change", () => {
      currentSettings[key] = input.checked;
      refreshAllTooltips();
      saveSettingsPatch({ [key]: input.checked }, statusEl);
    });
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  function buildSelectRow(labelText, key, options, statusEl) {
    const row = document.createElement("div");
    row.className = "agy-sp-row";
    const id = `agy-sp-${key}`;
    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = labelText;
    const select = document.createElement("select");
    select.id = id;
    select.className = "agy-sp-select";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (currentSettings[key] === opt.value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      currentSettings[key] = select.value;
      saveSettingsPatch({ [key]: select.value }, statusEl);
    });
    row.appendChild(label);
    row.appendChild(select);
    return row;
  }

  function toggleSettingsPopover(anchorBtn) {
    if (activePopoverEl) {
      closeSettingsPopover();
      return;
    }
    ensureStyle();

    const pop = document.createElement("div");
    pop.className = "agy-settings-popover";
    pop.setAttribute("data-testid", "enhance-settings-popover");

    const header = document.createElement("div");
    header.className = "agy-sp-header";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = "Prompt Enhancer Settings";
    const statusEl = document.createElement("span");
    statusEl.className = "agy-sp-status";
    header.appendChild(titleSpan);
    header.appendChild(statusEl);
    pop.appendChild(header);

    pop.appendChild(buildCheckboxRow("Enable Shortcut", "shortcutEnabled", statusEl));

    // Interactive shortcut recorder row
    const scRow = document.createElement("div");
    scRow.className = "agy-sp-row";
    const scLabel = document.createElement("label");
    scLabel.textContent = "Shortcut";
    const scWrap = document.createElement("div");
    scWrap.className = "agy-sp-shortcut-wrap";
    const scInput = document.createElement("input");
    scInput.type = "text";
    scInput.readOnly = true;
    scInput.className = "agy-sp-shortcut-input";
    scInput.value = currentSettings.shortcut || DEFAULT_UI_SETTINGS.shortcut;
    scInput.title = "Click and press desired shortcut combination";
    const defaultShortcutHint = "Click shortcut box, then press keys (e.g. Ctrl+Alt+E).";
    let pendingWarningHint = "";
    const scHint = document.createElement("div");
    scHint.className = "agy-sp-hint";
    scHint.textContent = defaultShortcutHint;

    scInput.addEventListener("focus", () => {
      isRecordingShortcut = true;
      pendingWarningHint = "";
      scHint.textContent = "Press key combination now (Esc to cancel)...";
    });
    scInput.addEventListener("blur", () => {
      isRecordingShortcut = false;
      scInput.value = currentSettings.shortcut || DEFAULT_UI_SETTINGS.shortcut;
      scHint.textContent = pendingWarningHint || defaultShortcutHint;
    });
    scInput.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        pendingWarningHint = "";
        scInput.blur();
        return;
      }
      const formatted = formatShortcutFromEvent(e);
      if (!formatted) return;
      pendingWarningHint =
        formatted === "Ctrl+E"
          ? "Warning: Ctrl+E is used by Quick Open; Ctrl+Alt+E recommended."
          : "";
      currentSettings.shortcut = formatted;
      scInput.value = formatted;
      refreshAllTooltips();
      saveSettingsPatch({ shortcut: formatted }, statusEl);
      isRecordingShortcut = false;
      scInput.blur();
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "agy-sp-mini-btn";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => {
      pendingWarningHint = "";
      scHint.textContent = defaultShortcutHint;
      currentSettings.shortcut = DEFAULT_UI_SETTINGS.shortcut;
      scInput.value = DEFAULT_UI_SETTINGS.shortcut;
      refreshAllTooltips();
      saveSettingsPatch({ shortcut: DEFAULT_UI_SETTINGS.shortcut }, statusEl);
    });

    scWrap.appendChild(scInput);
    scWrap.appendChild(resetBtn);
    scRow.appendChild(scLabel);
    scRow.appendChild(scWrap);
    pop.appendChild(scRow);
    pop.appendChild(scHint);

    pop.appendChild(
      buildSelectRow(
        "Output Language",
        "outputLanguage",
        [
          { value: "auto", label: "Auto (Follow Draft)" },
          { value: "id", label: "Indonesian" },
          { value: "en", label: "English" },
        ],
        statusEl
      )
    );
    pop.appendChild(
      buildSelectRow(
        "Detail Level",
        "detailLevel",
        [
          { value: "concise", label: "Concise" },
          { value: "balanced", label: "Balanced" },
          { value: "comprehensive", label: "Comprehensive" },
        ],
        statusEl
      )
    );
    pop.appendChild(buildCheckboxRow("Workspace Context", "includeWorkspaceContext", statusEl));
    pop.appendChild(buildCheckboxRow("Chat History Context", "includeConversationContext", statusEl));
    pop.appendChild(buildCheckboxRow("Status Toast", "showToast", statusEl));

    const footer = document.createElement("div");
    footer.className = "agy-sp-footer";
    const openVsBtn = document.createElement("button");
    openVsBtn.type = "button";
    openVsBtn.className = "agy-sp-mini-btn";
    openVsBtn.textContent = "Open VS Code Settings…";
    openVsBtn.addEventListener("click", async () => {
      try {
        const cfg = await loadConfig(false);
        const url = window.location.protocol.startsWith("http")
          ? "/__enhancer/open-vscode-settings"
          : `http://127.0.0.1:${cfg.port}/__enhancer/open-vscode-settings`;
        await fetch(url, {
          method: "POST",
          headers: { "X-Enhancer-Token": cfg.token },
        });
        closeSettingsPopover();
      } catch {
        // ignore
      }
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "agy-sp-mini-btn";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeSettingsPopover);
    footer.appendChild(openVsBtn);
    footer.appendChild(closeBtn);
    pop.appendChild(footer);

    document.body.appendChild(pop);
    const rect = anchorBtn.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const topPos = Math.max(12, rect.top - popRect.height - 8);
    const rightPos = Math.max(12, window.innerWidth - rect.right);
    pop.style.top = `${topPos}px`;
    pop.style.right = `${rightPos}px`;
    activePopoverEl = pop;
  }

  function findRightActionGroup(inputBox) {
    const sendBtn = inputBox.querySelector('[data-testid="send-button"]');
    if (sendBtn) {
      let node = sendBtn;
      while (node && node.parentElement && node.parentElement !== inputBox) {
        const cls = typeof node.parentElement.className === "string" ? node.parentElement.className : "";
        if (cls.includes("shrink-0") && cls.includes("items-center")) {
          return { rightGroup: node.parentElement, anchor: node };
        }
        node = node.parentElement;
      }
      if (sendBtn.parentElement) {
        return { rightGroup: sendBtn.parentElement, anchor: sendBtn };
      }
    }
    const candidates = inputBox.querySelectorAll('div[class*="shrink-0"][class*="items-center"]');
    for (const c of candidates) {
      if (!c.closest('[data-testid="input-box-bottom-toolbar"]')) {
        return { rightGroup: c, anchor: c.lastElementChild };
      }
    }
    return null;
  }

  function attachToInputBox(inputBox) {
    if (inputBox.querySelector('[data-testid="enhance-prompt-button"]')) return;
    const inputEl = inputBox.querySelector('[aria-label="Message input"][contenteditable="true"]');
    if (!inputEl) return;

    const target = findRightActionGroup(inputBox);
    if (!target || !target.rightGroup) return;

    ensureStyle();

    const group = document.createElement("div");
    group.className = "agy-enhance-group";

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "agy-settings-btn";
    settingsBtn.setAttribute("data-testid", "enhance-settings-button");
    settingsBtn.setAttribute("aria-label", "Prompt Enhancer Settings");
    settingsBtn.title = "Prompt Enhancer Settings";
    settingsBtn.appendChild(createGearSvg());
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsPopover(settingsBtn);
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "agy-enhance-btn";
    btn.setAttribute("data-testid", "enhance-prompt-button");
    btn.setAttribute("aria-label", "Enhance Prompt");
    btn.title = formatEnhanceTooltip();
    btn.appendChild(createSparkleSvg());

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnhanceClick(btn, inputBox, inputEl);
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsPopover(btn);
    });

    group.appendChild(settingsBtn);
    group.appendChild(btn);
    target.rightGroup.insertBefore(group, target.anchor || null);
    syncButtonDisabled(btn, inputEl);

    if (inputEl.dataset.agyEnhanceBound !== "1") {
      inputEl.dataset.agyEnhanceBound = "1";
      const editor = inputEl.__lexicalEditor;
      if (editor && typeof editor.registerUpdateListener === "function") {
        editor.registerUpdateListener(() => syncButtonDisabled(btn, inputEl));
      } else {
        inputEl.addEventListener("input", () => syncButtonDisabled(btn, inputEl));
      }
    }
  }

  function triggerEnhanceForActiveInput() {
    const activeEl = document.activeElement;
    let inputBox = activeEl && activeEl.closest ? activeEl.closest('[data-testid="agent-input-box"]') : null;
    if (!inputBox) {
      const boxes = document.querySelectorAll('[data-testid="agent-input-box"]');
      if (boxes.length > 0) inputBox = boxes[boxes.length - 1];
    }
    if (!inputBox) return false;
    const btn = inputBox.querySelector('[data-testid="enhance-prompt-button"]');
    const inputEl = inputBox.querySelector('[aria-label="Message input"][contenteditable="true"]');
    if (!btn || !inputEl) return false;
    handleEnhanceClick(btn, inputBox, inputEl);
    return true;
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (activePopoverEl && e.key === "Escape" && !isRecordingShortcut) {
        closeSettingsPopover();
        return;
      }
      if (isRecordingShortcut || !currentSettings.shortcutEnabled) return;
      if (matchesShortcutEvent(e, currentSettings.shortcut)) {
        if (triggerEnhanceForActiveInput()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    true
  );

  document.addEventListener("mousedown", (e) => {
    if (!activePopoverEl) return;
    const target = e.target;
    if (
      activePopoverEl.contains(target) ||
      (target && target.closest && target.closest('[data-testid="enhance-settings-button"]'))
    ) {
      return;
    }
    closeSettingsPopover();
  });

  if (window.location.protocol.startsWith("http") && typeof EventSource === "function") {
    try {
      const es = new EventSource("/__enhancer/events");
      es.addEventListener("settings", (evt) => {
        try {
          const parsed = JSON.parse(evt.data || "{}");
          currentSettings = { ...DEFAULT_UI_SETTINGS, ...parsed };
          refreshAllTooltips();
        } catch {
          // ignore
        }
      });
      es.addEventListener("enhance", () => {
        triggerEnhanceForActiveInput();
      });
      es.addEventListener("open-settings", () => {
        const gearBtn =
          document.querySelector('[data-testid="enhance-settings-button"]') ||
          document.querySelector('[data-testid="enhance-prompt-button"]');
        if (gearBtn) toggleSettingsPopover(gearBtn);
      });
    } catch {
      // ignore
    }
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    const boxes = document.querySelectorAll('[data-testid="agent-input-box"]');
    for (const box of boxes) {
      attachToInputBox(box);
    }
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  } else {
    scheduleScan();
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
