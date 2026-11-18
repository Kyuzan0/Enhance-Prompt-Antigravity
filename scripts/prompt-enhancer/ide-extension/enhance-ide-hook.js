// Antigravity IDE UI Hook for Enhance Prompt button.
// Trusted-Types safe: uses DOM APIs only (no innerHTML / eval).
(function () {
  if (window.__agyEnhanceIdeHookLoaded) return;
  window.__agyEnhanceIdeHookLoaded = true;

  const CHIP_TOKEN_PREFIX = "[[AGY_CHIP_";
  const CHIP_TOKEN_SUFFIX = "]]";
  let cachedConfig = null;
  let styleInjected = false;

  function ensureStyle() {
    if (styleInjected || !document.head) return;
    styleInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      @keyframes agyEnhanceSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .agy-enhance-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
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
      .agy-enhance-btn:hover:not(:disabled) {
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
    `;
    document.head.appendChild(style);
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
      const url = window.location.protocol.startsWith("http")
        ? "/__enhancer/client-log"
        : (cachedConfig ? `http://127.0.0.1:${cachedConfig.port}/__enhancer/client-log` : "");
      if (!url) return;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const editor = inputEl && inputEl.__lexicalEditor;
    if (!editor || btn.classList.contains("agy-enhancing")) return;

    const stateJson = editor.getEditorState().toJSON();
    const { text, chips, markers } = serializeLexicalState(stateJson);
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
        const nextJson = deserializeToLexicalJson(res.enhanced, chips, stateJson);
        let applied = false;
        if (typeof editor.parseEditorState === "function") {
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
      } else {
        btn.title = "No changes suggested";
      }
    } catch (err) {
      console.error("[EnhanceHook] Enhance failed:", err);
      btn.classList.add("agy-error");
      btn.title = `Enhance failed: ${err && err.message ? err.message : String(err)}`;
      setTimeout(() => btn.classList.remove("agy-error"), 4000);
    } finally {
      btn.classList.remove("agy-enhancing");
      syncButtonDisabled(btn, inputEl);
    }
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

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "agy-enhance-btn";
    btn.setAttribute("data-testid", "enhance-prompt-button");
    btn.setAttribute("aria-label", "Enhance Prompt");
    btn.title = "Enhance Prompt";
    btn.appendChild(createSparkleSvg());

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnhanceClick(btn, inputBox, inputEl);
    });

    target.rightGroup.insertBefore(btn, target.anchor || null);
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
