import "./styles/adjutorix-power-workbench.css";

type JsonRecord = Record<string, unknown>;

type FileEntry = {
  path: string;
  name: string;
  size: number;
  kind: "source" | "test" | "config" | "doc" | "asset" | "other";
};

type Tab = {
  path: string;
  content: string;
  dirty: boolean;
};

type BridgeWindow = Window & {
  adjutorixPower?: {
    runCommand?: (request: { workspace: string; command: string }) => Promise<unknown>;
    createPlan?: (request: { workspace: string; intent: string; activeFile?: string }) => Promise<unknown>;
    saveDraft?: (request: { workspace: string; path: string; content: string }) => Promise<unknown>;
    scanWorkspace?: (workspace: string) => Promise<unknown>;
  };
  adjutorix?: JsonRecord;
};

const bridgeWindow = window as BridgeWindow;

const state = {
  workspace:
    window.localStorage.getItem("adjutorix.workspace") ??
    "/Users/midiakiasat/Downloads/Apps/midiakiasat/E-LOGISTIC",
  files: [] as FileEntry[],
  tabs: [] as Tab[],
  activePath: "README.md",
  activePanel: "agent",
  intent: "",
  verifyGate: "required",
  applyGate: "blocked",
  featureOutput: "No feature executed yet.",
  terminal: [
    "ADJUTORIX revolution operator surface online.",
    "Real workspace index, command execution, plan objects, verification gate, diff, ledger, diagnostics.",
  ],
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM node: ${id}`);
  return el as T;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function html(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unwrap(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  const row = record(value);
  if (!row) return value;

  for (const key of ["stdout", "output", "text", "content", "path", "message"]) {
    if (typeof row[key] === "string") return row[key];
  }

  for (const key of ["data", "payload", "result", "value", "body", "envelope"]) {
    if (key in row) return unwrap(row[key], depth + 1);
  }

  return value;
}

function textOf(value: unknown): string {
  const unwrapped = unwrap(value);
  if (typeof unwrapped === "string") return unwrapped;
  try {
    return JSON.stringify(unwrapped, null, 2);
  } catch {
    return String(unwrapped);
  }
}

function markerText(text: string, begin: string, end: string): string | null {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start < 0 || stop < 0 || stop <= start) return null;
  return text.slice(start + begin.length, stop).trim();
}


function normalizeFileEntries(rows: unknown): FileEntry[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const file = record(row);
      if (!file || typeof file.path !== "string") return null;

      const name =
        typeof file.name === "string"
          ? file.name
          : file.path.split("/").pop() || file.path;

      return {
        path: file.path,
        name,
        size: Number(file.size ?? 0),
        kind: classify(file.path),
      } satisfies FileEntry;
    })
    .filter((row): row is FileEntry => Boolean(row));
}

function extractFileEntriesFromText(text: string): FileEntry[] {
  const marked = markerText(text, "__ADJUTORIX_SCAN_BEGIN__", "__ADJUTORIX_SCAN_END__");
  const candidates = [
    marked,
    text.trim(),
    (() => {
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      return start >= 0 && end > start ? text.slice(start, end + 1) : "";
    })(),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const direct = normalizeFileEntries(parsed);
      if (direct.length > 0) return direct;
      const nested = extractFileEntries(parsed);
      if (nested.length > 0) return nested;
    } catch {
      // continue
    }
  }

  const lineRows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tabParts = line.split("\t");
      const path = tabParts[0]?.replace(/^\.\//, "");
      if (!path || path.startsWith("$ ") || path.startsWith("python3 ")) return null;
      if (path.includes("__ADJUTORIX_")) return null;
      if (path.length > 240) return null;
      return {
        path,
        name: path.split("/").pop() || path,
        size: Number(tabParts[2] ?? 0),
        kind: classify(path),
      } satisfies FileEntry;
    })
    .filter((row): row is FileEntry => Boolean(row));

  return lineRows;
}

function extractFileEntries(value: unknown, depth = 0): FileEntry[] {
  if (depth > 8) return [];

  if (typeof value === "string") {
    return extractFileEntriesFromText(value);
  }

  if (Array.isArray(value)) {
    const direct = normalizeFileEntries(value);
    if (direct.length > 0) return direct;

    for (const item of value) {
      const nested = extractFileEntries(item, depth + 1);
      if (nested.length > 0) return nested;
    }

    return [];
  }

  const row = record(value);
  if (!row) return [];

  for (const key of ["files", "entries", "items", "rows", "children"]) {
    const nested = extractFileEntries(row[key], depth + 1);
    if (nested.length > 0) return nested;
  }

  for (const key of ["data", "payload", "result", "value", "body", "envelope", "stdout", "output", "text", "content"]) {
    const nested = extractFileEntries(row[key], depth + 1);
    if (nested.length > 0) return nested;
  }

  return [];
}

function classify(path: string): FileEntry["kind"] {
  if (/(\.test\.|\.spec\.|\/tests?\/|__tests__)/i.test(path)) return "test";
  if (/(^|\/)(package\.json|pnpm-workspace\.yaml|tsconfig|vite|vitest|eslint|configs?\/|\.github\/)/i.test(path)) return "config";
  if (/\.(md|mdx|txt)$/i.test(path)) return "doc";
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|pdf)$/i.test(path)) return "asset";
  if (/\.(ts|tsx|js|jsx|py|sh|css|html|json|yml|yaml|swift|rs|go)$/i.test(path)) return "source";
  return "other";
}

function activeTab(): Tab {
  let tab = state.tabs.find((candidate) => candidate.path === state.activePath);
  if (!tab) {
    tab = {
      path: state.activePath,
      content:
        "# ADJUTORIX\n\nAsk for a change. Inspect the repository. Generate a governed plan. Verify before mutation. Keep apply blocked until the evidence gate opens.\n",
      dirty: false,
    };
    state.tabs.push(tab);
  }
  return tab;
}

function terminal(line: string): void {
  state.terminal.push(line);
  if (state.terminal.length > 260) state.terminal.splice(0, state.terminal.length - 260);
  const pre = document.getElementById("adj-rev-terminal");
  if (pre) pre.textContent = state.terminal.join("\n");
}

function output(title: string, value: unknown): void {
  state.featureOutput = `${title}\n\n${textOf(value)}`;
  const pre = document.getElementById("adj-rev-output");
  if (pre) pre.textContent = state.featureOutput;
}

async function run(command: string): Promise<string> {
  terminal(`$ ${command}`);

  try {
    if (typeof bridgeWindow.adjutorixPower?.runCommand === "function") {
      const result = await bridgeWindow.adjutorixPower.runCommand({
        workspace: state.workspace,
        command,
      });
      const text = textOf(result);
      terminal(text.slice(0, 6000));
      return text;
    }

    const shell = record(bridgeWindow.adjutorix?.shell);
    const execute = shell?.execute;
    if (typeof execute === "function") {
      const result = await (execute as (request: { workspace: string; command: string }) => Promise<unknown>)({
        workspace: state.workspace,
        command,
      });
      const text = textOf(result);
      terminal(text.slice(0, 6000));
      return text;
    }

    const message = "No governed command bridge is exposed.";
    terminal(message);
    return message;
  } catch (error) {
    const message = textOf(error);
    terminal(message);
    return message;
  }
}

function renderStatusBase(): void {
  byId("adj-rev-workspace").textContent = state.workspace;
  byId("adj-rev-status-workspace").textContent = state.workspace;
  byId("adj-rev-file-count").textContent = String(state.files.length);
  byId("adj-rev-verify-gate").textContent = state.verifyGate;
  byId("adj-rev-apply-gate").textContent = state.applyGate;

  const footerFiles = document.getElementById("adj-rev-file-count-footer");
  const footerVerify = document.getElementById("adj-rev-verify-footer");
  const footerApply = document.getElementById("adj-rev-apply-footer");
  if (footerFiles) footerFiles.textContent = String(state.files.length);
  if (footerVerify) footerVerify.textContent = state.verifyGate;
  if (footerApply) footerApply.textContent = state.applyGate;
}

function renderStatus(): void {
  renderStatusBase();
}

function renderTabs(): void {
  const tabs = byId<HTMLDivElement>("adj-rev-tabs");
  tabs.innerHTML = state.tabs
    .map(
      (tab) => `
        <button class="${tab.path === state.activePath ? "is-active" : ""}" data-open-tab="${html(tab.path)}">
          ${html(tab.path.split("/").pop() ?? tab.path)}${tab.dirty ? " •" : ""}
        </button>
      `,
    )
    .join("");

  for (const button of Array.from(tabs.querySelectorAll<HTMLButtonElement>("[data-open-tab]"))) {
    button.addEventListener("click", () => {
      state.activePath = button.dataset.openTab ?? state.activePath;
      renderEditor();
      renderTabs();
    });
  }
}

function renderEditor(): void {
  const tab = activeTab();
  byId("adj-rev-file-title").textContent = tab.path;
  byId("adj-rev-file-kind").textContent = classify(tab.path);
  byId<HTMLTextAreaElement>("adj-rev-editor").value = tab.content;
  renderTabs();
}

function renderFiles(): void {
  const query = byId<HTMLInputElement>("adj-rev-search").value.trim().toLowerCase();
  const kindFilter = byId<HTMLSelectElement>("adj-rev-kind").value;
  const list = byId<HTMLDivElement>("adj-rev-files");

  const rows = state.files.filter((file) => {
    const queryOk = !query || file.path.toLowerCase().includes(query);
    const kindOk = kindFilter === "all" || file.kind === kindFilter;
    return queryOk && kindOk;
  });

  list.innerHTML = rows
    .slice(0, 900)
    .map(
      (file) => `
        <button class="adj-rev-file ${file.path === state.activePath ? "is-active" : ""}" data-file="${html(file.path)}">
          <strong>${html(file.name)}</strong>
          <span>${html(file.path)}</span>
          <em>${html(file.kind)}</em>
        </button>
      `,
    )
    .join("");

  for (const button of Array.from(list.querySelectorAll<HTMLButtonElement>("[data-file]"))) {
    button.addEventListener("click", () => void openFile(button.dataset.file ?? ""));
  }

  renderStatus();
}

function renderPanel(): void {
  for (const panel of Array.from(document.querySelectorAll<HTMLElement>("[data-panel]"))) {
    panel.hidden = panel.dataset.panel !== state.activePanel;
  }

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-panel-button]"))) {
    button.classList.toggle("is-active", button.dataset.panelButton === state.activePanel);
  }
}

async function scan(): Promise<void> {
  state.workspace = byId<HTMLInputElement>("adj-rev-workspace-input").value.trim() || state.workspace;
  window.localStorage.setItem("adjutorix.workspace", state.workspace);
  renderStatus();

  terminal(`Scanning real workspace: ${state.workspace}`);

  try {
    if (typeof bridgeWindow.adjutorixPower?.scanWorkspace === "function") {
      const bridgeResult = await bridgeWindow.adjutorixPower.scanWorkspace(state.workspace);
      const bridgeFiles = extractFileEntries(bridgeResult);

      if (bridgeFiles.length > 0) {
        state.files = bridgeFiles;
        renderFiles();

        const first =
          bridgeFiles.find((file) => /^README\.md$/i.test(file.path)) ??
          bridgeFiles.find((file) => /^package\.json$/i.test(file.path)) ??
          bridgeFiles.find((file) => file.kind === "source") ??
          bridgeFiles[0];

        if (first) await openFile(first.path);

        console.log("ADJUTORIX_SCAN_INDEX_READY", JSON.stringify({ count: state.files.length, source: "bridge", workspace: state.workspace }));
        output("REAL WORKSPACE INDEX READY", `${state.files.length} files indexed through governed bridge.\nWorkspace: ${state.workspace}`);
        return;
      }

      terminal("Governed scan bridge returned no file rows; falling back to command scan.");
    }
  } catch (error) {
    terminal(`Governed scan bridge failed; falling back to command scan: ${textOf(error)}`);
  }

  const command = `python3 - <<'PY'
import json, os, pathlib
root = pathlib.Path.cwd().resolve()
skip = {".git", "node_modules", "dist", "release", ".tmp", "__pycache__", ".venv", "venv", ".next", ".turbo"}
rows = []
for current, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".cache")]
    for name in files:
        path = pathlib.Path(current) / name
        try:
            rel = path.relative_to(root).as_posix()
            size = path.stat().st_size
        except OSError:
            continue
        if any(part in skip for part in pathlib.Path(rel).parts):
            continue
        rows.append({"path": rel, "name": name, "size": size})
rows.sort(key=lambda row: (row["path"].count("/"), row["path"].lower()))
print("__ADJUTORIX_SCAN_BEGIN__")
print(json.dumps(rows[:2600]))
print("__ADJUTORIX_SCAN_END__")
PY`;

  const raw = await run(command);
  const parsed = extractFileEntries(raw);

  state.files = parsed;
  renderFiles();

  const first =
    parsed.find((file) => /^README\.md$/i.test(file.path)) ??
    parsed.find((file) => /^package\.json$/i.test(file.path)) ??
    parsed.find((file) => file.kind === "source") ??
    parsed[0];

  if (first) await openFile(first.path);

  if (parsed.length <= 0) {
    console.error("ADJUTORIX_SCAN_INDEX_EMPTY", { workspace: state.workspace, raw: raw.slice(0, 1800) });
    output("SCAN FAILED", `No files indexed.\nWorkspace: ${state.workspace}\n\nRaw scan output:\n${raw.slice(0, 4000)}`);
    return;
  }

  console.log("ADJUTORIX_SCAN_INDEX_READY", JSON.stringify({ count: state.files.length, source: "command", workspace: state.workspace }));
  output("REAL WORKSPACE INDEX READY", `${state.files.length} files indexed.\nWorkspace: ${state.workspace}`);
}

async function openFile(path: string): Promise<void> {
  if (!path) return;

  state.activePath = path;

  const begin = "__ADJUTORIX_FILE_BEGIN__";
  const end = "__ADJUTORIX_FILE_END__";
  const path64 = base64Utf8(path);

  const command = `python3 - <<'PY'
import base64, pathlib, sys
rel = base64.b64decode("${path64}").decode("utf-8")
root = pathlib.Path.cwd().resolve()
target = (root / rel).resolve()
if root not in target.parents and target != root:
    raise SystemExit("outside workspace")
print("${begin}")
try:
    print(target.read_text(encoding="utf-8", errors="replace"))
except Exception as exc:
    print(f"READ_FAILED: {exc}")
print("${end}")
PY`;

  const raw = await run(command);
  const content = markerText(raw, begin, end) ?? raw;

  let tab = state.tabs.find((candidate) => candidate.path === path);
  if (!tab) {
    tab = { path, content, dirty: false };
    state.tabs.push(tab);
  } else {
    tab.content = content;
  }

  renderEditor();
  renderFiles();
}

async function saveDraft(): Promise<void> {
  const tab = activeTab();
  tab.content = byId<HTMLTextAreaElement>("adj-rev-editor").value;
  tab.dirty = false;

  if (typeof bridgeWindow.adjutorixPower?.saveDraft === "function") {
    const result = await bridgeWindow.adjutorixPower.saveDraft({
      workspace: state.workspace,
      path: tab.path,
      content: tab.content,
    });
    output("DRAFT SAVED THROUGH GOVERNED BRIDGE", result);
    renderTabs();
    return;
  }

  const content64 = base64Utf8(tab.content);
  const path64 = base64Utf8(tab.path);

  const result = await run(`python3 - <<'PY'
import base64, pathlib, time
path = base64.b64decode("${path64}").decode("utf-8")
content = base64.b64decode("${content64}").decode("utf-8")
root = pathlib.Path.cwd().resolve()
out = root / ".adjutorix" / "workbench-drafts"
out.mkdir(parents=True, exist_ok=True)
safe = path.replace("/", "__")
target = out / f"{int(time.time())}-{safe}"
target.write_text(content, encoding="utf-8")
print(target)
PY`);
  output("DRAFT SAVED", result);
  renderTabs();
}

async function createPlan(): Promise<void> {
  const intent = byId<HTMLTextAreaElement>("adj-rev-intent").value.trim();
  state.intent = intent;

  if (!intent) {
    output("PLAN BLOCKED", "Describe the change first.");
    return;
  }

  if (typeof bridgeWindow.adjutorixPower?.createPlan === "function") {
    const result = await bridgeWindow.adjutorixPower.createPlan({
      workspace: state.workspace,
      intent,
      activeFile: state.activePath,
    });
    output("GOVERNED PLAN OBJECT CREATED", result);
    state.activePanel = "plan";
    renderPanel();
    return;
  }

  const payload = {
    schema: 1,
    kind: "adjutorix.operator.plan",
    createdAt: new Date().toISOString(),
    workspace: state.workspace,
    activeFile: state.activePath,
    intent,
    applyGate: "blocked_until_verify",
    tasks: [
      "inspect relevant files",
      "generate patch proposal",
      "run typecheck and tests",
      "review diff",
      "verify before apply",
    ],
  };

  const payload64 = base64Utf8(JSON.stringify(payload, null, 2));
  const result = await run(`python3 - <<'PY'
import base64, pathlib, time
payload = base64.b64decode("${payload64}").decode("utf-8")
root = pathlib.Path.cwd().resolve()
out = root / ".adjutorix" / "objects"
out.mkdir(parents=True, exist_ok=True)
target = out / f"intent-plan-{int(time.time())}.json"
target.write_text(payload, encoding="utf-8")
print(target)
PY`);
  output("PLAN OBJECT CREATED", result);
  state.activePanel = "plan";
  renderPanel();
}

async function runAgentLoop(): Promise<void> {
  await createPlan();

  const intent = state.intent || byId<HTMLTextAreaElement>("adj-rev-intent").value.trim();
  const query = intent
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 8)
    .join("|");

  const searchCommand = query
    ? `grep -RInE "${query.replaceAll('"', '\\"')}" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=release --exclude-dir=.tmp | head -160`
    : `find . -maxdepth 4 -type f | head -160`;

  const found = await run(searchCommand);
  const diff = await run("git status --short && git diff --stat");
  output("AGENT LOOP: PLAN + RELEVANCE + DIFF", `${found}\n\n--- DIFF STATE ---\n${diff}`);
}

async function feature(name: string): Promise<void> {
  const commandMap: Record<string, string> = {
    git: "git status --short && echo '--- branch ---' && git branch --show-current && echo '--- recent commits ---' && git log --oneline --decorate --max-count=12",
    diff: "git diff --stat && echo '--- diff preview ---' && git diff -- . ':(exclude)package-lock.json' | head -1800",
    verify: "pnpm run verify",
    build: "pnpm -r --if-present run build",
    typecheck: "pnpm --filter @adjutorix/app run build:ts",
    tests: "pnpm --filter @adjutorix/app exec vitest run tests/renderer/operator_kernel_live_surface_contract.test.ts tests/renderer/operator_surface_spine_contract.test.ts tests/renderer/operator_unified_control_spine_contract.test.ts",
    ipc: "grep -R \"ipcMain.handle\\|ipcRenderer.invoke\\|exposeInMainWorld\\|safeHandle\" packages/adjutorix-app/src configs/ci -n | head -300",
    routes: "find . -maxdepth 6 \\( -name '*route*' -o -name '*router*' -o -name '*ipc*' -o -name '*bridge*' \\) -not -path './node_modules/*' -not -path './.git/*' | sort | head -300",
    diagnostics: "find .tmp reports/current ~/Library/Logs -maxdepth 5 -type f 2>/dev/null | grep -i adjutorix | sort | tail -220",
    ledger: "find . .adjutorix reports/current -maxdepth 5 \\( -iname '*ledger*' -o -iname '*receipt*' -o -iname '*evidence*' -o -iname '*finality*' \\) -type f 2>/dev/null | sort | head -220",
    package: "ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh",
  };

  if (name === "scan") return void (await scan());
  if (name === "plan") return void (await createPlan());
  if (name === "agent") return void (await runAgentLoop());
  if (name === "save") return void (await saveDraft());

  const command = commandMap[name];
  if (!command) {
    output("UNKNOWN FEATURE", name);
    return;
  }

  const result = await run(command);
  output(name.toUpperCase(), result);

  if (name === "verify" && !/ERR_|FAIL|failed|error/i.test(result)) {
    state.verifyGate = "passed";
    state.applyGate = "review required";
    renderStatus();
  }
}

function mount(): void {
  document.title = "Adjutorix";
  document.documentElement.dataset.adjutorixRendererBoot = "revolution-mounted";

  let root = document.getElementById("root");
  if (!root) {
    root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <main class="adj-rev" data-adjutorix-real-workbench="true">
      <aside class="adj-rev-rail">
        <button class="is-active">⌘</button>
        <button>⌕</button>
        <button>⑂</button>
        <button>✓</button>
        <button>◆</button>
        <button>⚙</button>
      </aside>

      <section class="adj-rev-explorer">
        <header>
          <strong>EXPLORER</strong>
          <button data-feature="scan">Open</button>
        </header>

        <section class="adj-rev-workspace">
          <p>WORKSPACE</p>
          <strong id="adj-rev-workspace">${html(state.workspace)}</strong>
          <div>
            <input id="adj-rev-workspace-input" value="${html(state.workspace)}" />
            <button data-feature="scan">Load</button>
          </div>
        </section>

        <section class="adj-rev-filter">
          <input id="adj-rev-search" placeholder="Search files, tests, routes, IPC, configs..." />
          <select id="adj-rev-kind">
            <option value="all">all</option>
            <option value="source">source</option>
            <option value="test">test</option>
            <option value="config">config</option>
            <option value="doc">doc</option>
          </select>
        </section>

        <section class="adj-rev-project-intel">
          <h2>Project intelligence</h2>
          <div>
            <article><strong id="adj-rev-file-count">0</strong><span>files</span></article>
            <article><strong id="adj-rev-verify-gate">required</strong><span>verify</span></article>
            <article><strong id="adj-rev-apply-gate">blocked</strong><span>apply</span></article>
          </div>
        </section>

        <div id="adj-rev-files" class="adj-rev-files"></div>
      </section>

      <section class="adj-rev-workbench">
        <header class="adj-rev-top">
          <div>
            <h1>ADJUTORIX</h1>
            <p>governed mutation IDE · real command surface · no hidden apply</p>
          </div>
          <input id="adj-rev-command" placeholder="Ask Adjutorix: generate plan, inspect, diff, verify..." />
          <button data-feature="agent">Agent run</button>
          <button data-feature="verify">Verify</button>
        </header>

        <nav id="adj-rev-tabs" class="adj-rev-tabs"></nav>

        <section class="adj-rev-editor-head">
          <strong id="adj-rev-file-title">README.md</strong>
          <span id="adj-rev-file-kind">doc</span>
        </section>

        <textarea id="adj-rev-editor" class="adj-rev-editor"></textarea>

        <section class="adj-rev-terminal">
          <header>
            <strong>TERMINAL</strong>
            <input id="adj-rev-shell" value="git status --short" />
            <button id="adj-rev-run-shell">Run</button>
          </header>
          <pre id="adj-rev-terminal"></pre>
        </section>
      </section>

      <aside class="adj-rev-agent">
        <nav>
          <button class="is-active" data-panel-button="agent">AGENT</button>
          <button data-panel-button="plan">PLAN</button>
          <button data-panel-button="verify">VERIFY</button>
          <button data-panel-button="diff">DIFF</button>
          <button data-panel-button="ledger">LEDGER</button>
        </nav>

        <section data-panel="agent" class="adj-rev-panel">
          <p>ADJUTORIX AGENT</p>
          <h2>Tell it what to change.</h2>
          <textarea id="adj-rev-intent" placeholder="Example: add barcode validation, refactor scanner flow, update tests, verify before apply..."></textarea>
          <button data-feature="agent">Generate plan + inspect + diff</button>
        </section>

        <section data-panel="plan" class="adj-rev-panel" hidden>
          <p>PLAN ENGINE</p>
          <h2>Governed plan object.</h2>
          <button data-feature="plan">Create plan object</button>
          <button data-feature="save">Save active draft</button>
          <button data-feature="routes">Map routes</button>
        </section>

        <section data-panel="verify" class="adj-rev-panel" hidden>
          <p>VERIFY ENGINE</p>
          <h2>Gate before mutation.</h2>
          <button data-feature="verify">Full verify</button>
          <button data-feature="typecheck">Typecheck</button>
          <button data-feature="tests">Tests</button>
          <button data-feature="build">Build</button>
        </section>

        <section data-panel="diff" class="adj-rev-panel" hidden>
          <p>DIFF ENGINE</p>
          <h2>Review before apply.</h2>
          <button data-feature="git">Git status</button>
          <button data-feature="diff">Diff preview</button>
          <button data-feature="ipc">IPC map</button>
        </section>

        <section data-panel="ledger" class="adj-rev-panel" hidden>
          <p>LEDGER + DIAGNOSTICS</p>
          <h2>Evidence surface.</h2>
          <button data-feature="ledger">Ledger files</button>
          <button data-feature="diagnostics">Diagnostics</button>
          <button data-feature="package">Package app</button>
        </section>

        <section class="adj-rev-feature-grid">
          <p>ADJUTORIX FEATURES</p>
          <button data-feature="scan">Scan</button>
          <button data-feature="git">Git</button>
          <button data-feature="diff">Diff</button>
          <button data-feature="verify">Verify</button>
          <button data-feature="build">Build</button>
          <button data-feature="typecheck">Typecheck</button>
          <button data-feature="tests">Tests</button>
          <button data-feature="ipc">IPC Map</button>
          <button data-feature="diagnostics">Diagnostics</button>
          <button data-feature="ledger">Ledger</button>
          <button data-feature="save">Save Draft</button>
          <button data-feature="package">Package</button>
        </section>

        <section class="adj-rev-output">
          <p>FEATURE OUTPUT</p>
          <pre id="adj-rev-output">${html(state.featureOutput)}</pre>
        </section>
      </aside>

      <footer class="adj-rev-status">
        <span>Adjutorix</span>
        <span id="adj-rev-status-workspace">${html(state.workspace)}</span>
        <span>Files: <b id="adj-rev-file-count-footer">0</b></span>
        <span>Verify: <b id="adj-rev-verify-footer">required</b></span>
        <span>Apply: <b id="adj-rev-apply-footer">blocked</b></span>
      </footer>
    </main>
  `;

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-feature]"))) {
    button.addEventListener("click", () => void feature(button.dataset.feature ?? ""));
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-panel-button]"))) {
    button.addEventListener("click", () => {
      state.activePanel = button.dataset.panelButton ?? "agent";
      renderPanel();
    });
  }

  byId<HTMLInputElement>("adj-rev-search").addEventListener("input", renderFiles);
  byId<HTMLSelectElement>("adj-rev-kind").addEventListener("change", renderFiles);

  byId<HTMLTextAreaElement>("adj-rev-editor").addEventListener("input", () => {
    const tab = activeTab();
    tab.content = byId<HTMLTextAreaElement>("adj-rev-editor").value;
    tab.dirty = true;
    renderTabs();
  });

  byId<HTMLTextAreaElement>("adj-rev-intent").addEventListener("input", () => {
    state.intent = byId<HTMLTextAreaElement>("adj-rev-intent").value;
  });

  byId<HTMLInputElement>("adj-rev-command").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void runAgentLoop();
  });

  byId<HTMLButtonElement>("adj-rev-run-shell").addEventListener("click", () => {
    void run(byId<HTMLInputElement>("adj-rev-shell").value);
  });

  byId<HTMLInputElement>("adj-rev-shell").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void run(byId<HTMLInputElement>("adj-rev-shell").value);
  });

  renderPanel();
  renderEditor();
  renderFiles();
  renderStatus();

  window.setTimeout(() => void scan(), 250);
  console.log("ADJUTORIX_REVOLUTION_OPERATOR_SURFACE_MOUNTED");
}

try {
  mount();
} catch (error) {
  let root = document.getElementById("root");
  if (!root) {
    root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <main class="adj-rev-fatal">
      <section>
        <p>ADJUTORIX RENDERER FAILURE</p>
        <h1>Operator IDE failed to mount.</h1>
        <pre>${html(error instanceof Error ? error.stack ?? error.message : String(error))}</pre>
      </section>
    </main>
  `;
  console.error("ADJUTORIX_REVOLUTION_OPERATOR_SURFACE_FAILED", error);
}
