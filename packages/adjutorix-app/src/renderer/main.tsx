import "./styles/adjutorix-power-workbench.css";

type AnyRecord = Record<string, unknown>;

type FileEntry = {
  path: string;
  name: string;
  size?: number;
};

type PowerBridge = {
  openRepository?: () => Promise<unknown>;
  scanWorkspace?: (workspace: string) => Promise<unknown>;
  readFile?: (request: { workspace: string; path: string }) => Promise<unknown>;
  saveDraft?: (request: { workspace: string; path: string; content: string }) => Promise<unknown>;
  createPlan?: (request: { workspace: string; intent: string; activeFile?: string }) => Promise<unknown>;
  runCommand?: (request: { workspace: string; command: string }) => Promise<unknown>;
};

type RuntimeWindow = Window & {
  adjutorixPower?: PowerBridge;
  adjutorix?: AnyRecord;
};

const runtimeWindow = window as RuntimeWindow;

const state = {
  workspace:
    window.localStorage.getItem("adjutorix.workspace") ??
    "/Users/midiakiasat/Downloads/Apps/midiakiasat/E-LOGISTIC",
  files: [] as FileEntry[],
  activeFile: "ADJUTORIX.md",
  activeContent:
    "# Adjutorix\n\nOpen a repository. Tell Adjutorix what to change. Generate a governed plan. Verify. Apply stays blocked until verification opens the gate.\n",
  intent: "",
  featureOutput: "Ready.",
  terminal: ["ADJUTORIX native operator IDE online."],
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function unwrap(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  const record = asRecord(value);
  if (!record) return value;

  for (const key of ["stdout", "output", "text", "content", "path"]) {
    if (typeof record[key] === "string") return record[key];
  }

  for (const key of ["data", "payload", "result", "value", "body"]) {
    if (key in record) return unwrap(record[key], depth + 1);
  }

  return value;
}

function outputText(value: unknown): string {
  const unwrapped = unwrap(value);
  if (typeof unwrapped === "string") return unwrapped;
  try {
    return JSON.stringify(unwrapped, null, 2);
  } catch {
    return String(unwrapped);
  }
}

function betweenMarkers(text: string, begin: string, end: string): string | null {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start < 0 || stop < 0 || stop <= start) return null;
  return text.slice(start + begin.length, stop).trim();
}

function log(line: string): void {
  state.terminal.push(line);
  if (state.terminal.length > 200) state.terminal.splice(0, state.terminal.length - 200);
  const terminal = document.getElementById("adjx-terminal");
  if (terminal) terminal.textContent = state.terminal.join("\n");
}

function setOutput(title: string, value: unknown): void {
  state.featureOutput = `${title}\n\n${outputText(value)}`;
  const output = document.getElementById("adjx-output");
  if (output) output.textContent = state.featureOutput;
}

async function runCommand(command: string): Promise<string> {
  log(`$ ${command}`);
  const power = runtimeWindow.adjutorixPower;

  if (power?.runCommand) {
    const result = await power.runCommand({ workspace: state.workspace, command });
    const text = outputText(result);
    log(text.slice(0, 4000));
    return text;
  }

  const bridge = runtimeWindow.adjutorix;
  const shell = asRecord(bridge?.shell);
  const execute = shell?.execute;

  if (typeof execute === "function") {
    const result = await execute({ workspace: state.workspace, command });
    const text = outputText(result);
    log(text.slice(0, 4000));
    return text;
  }

  const message = "No governed command bridge is exposed.";
  log(message);
  return message;
}

function renderFiles(): void {
  const list = byId<HTMLDivElement>("adjx-file-list");
  const query = byId<HTMLInputElement>("adjx-search").value.trim().toLowerCase();
  const files = state.files.filter((file) => {
    if (!query) return true;
    return file.path.toLowerCase().includes(query);
  });

  list.innerHTML = files
    .slice(0, 600)
    .map(
      (file) => `
        <button class="adjx-file ${file.path === state.activeFile ? "is-active" : ""}" data-file="${escapeHtml(file.path)}">
          <strong>${escapeHtml(file.name)}</strong>
          <span>${escapeHtml(file.path)}</span>
        </button>
      `,
    )
    .join("");

  for (const button of Array.from(list.querySelectorAll<HTMLButtonElement>("[data-file]"))) {
    button.addEventListener("click", () => {
      void openFile(button.dataset.file ?? "");
    });
  }

  byId("adjx-files-count").textContent = String(state.files.length);
}

function renderEditor(): void {
  byId("adjx-tab").textContent = state.activeFile;
  byId("adjx-file-title").textContent = state.activeFile;
  byId<HTMLTextAreaElement>("adjx-editor").value = state.activeContent;
}

async function scanWorkspace(): Promise<void> {
  state.workspace = byId<HTMLInputElement>("adjx-workspace-input").value.trim() || state.workspace;
  window.localStorage.setItem("adjutorix.workspace", state.workspace);
  byId("adjx-workspace-label").textContent = state.workspace;
  log(`Scanning ${state.workspace}`);

  const markerBegin = "__ADJUTORIX_SCAN_JSON_BEGIN__";
  const markerEnd = "__ADJUTORIX_SCAN_JSON_END__";
  const command = `python3 - <<'PY'
import json, os, pathlib
root = pathlib.Path.cwd()
skip = {".git", "node_modules", "dist", "release", ".tmp", "__pycache__", ".venv", "venv"}
rows = []
for current, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".cache")]
    for name in files:
        path = pathlib.Path(current) / name
        rel = path.relative_to(root).as_posix()
        if rel.startswith(".git/") or "/node_modules/" in rel:
            continue
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        rows.append({"path": rel, "name": name, "size": size})
rows.sort(key=lambda row: (row["path"].count("/"), row["path"].lower()))
print("${markerBegin}")
print(json.dumps(rows[:1600]))
print("${markerEnd}")
PY`;

  let parsed: FileEntry[] = [];

  try {
    const text = await runCommand(command);
    const jsonText = betweenMarkers(text, markerBegin, markerEnd);
    if (jsonText) parsed = JSON.parse(jsonText) as FileEntry[];
  } catch (error) {
    log(`Scan failed: ${outputText(error)}`);
  }

  if (!parsed.length && runtimeWindow.adjutorixPower?.scanWorkspace) {
    try {
      const result = await runtimeWindow.adjutorixPower.scanWorkspace(state.workspace);
      const record = asRecord(result);
      const data = asRecord(record?.data) ?? record;
      const files = data?.files;
      if (Array.isArray(files)) {
        parsed = files
          .map((file) => {
            const row = asRecord(file);
            const path = String(row?.path ?? row?.relativePath ?? row?.name ?? "");
            return { path, name: path.split("/").pop() ?? path, size: Number(row?.size ?? 0) };
          })
          .filter((file) => file.path);
      }
    } catch (error) {
      log(`Bridge scan failed: ${outputText(error)}`);
    }
  }

  state.files = parsed;
  renderFiles();
  setOutput("SCAN", `${parsed.length} real files indexed in ${state.workspace}`);

  const preferred =
    parsed.find((file) => /^README\.md$/i.test(file.path)) ??
    parsed.find((file) => /^package\.json$/i.test(file.path)) ??
    parsed.find((file) => /\.(ts|tsx|js|jsx|md|json|css|html)$/i.test(file.path));

  if (preferred) await openFile(preferred.path);

  log(`REAL FILE INDEX READY: ${parsed.length} files`);
}

async function openFile(path: string): Promise<void> {
  if (!path) return;
  state.activeFile = path;

  const markerBegin = "__ADJUTORIX_FILE_BEGIN__";
  const markerEnd = "__ADJUTORIX_FILE_END__";

  try {
    if (runtimeWindow.adjutorixPower?.readFile) {
      const result = await runtimeWindow.adjutorixPower.readFile({ workspace: state.workspace, path });
      const record = asRecord(result);
      const data = asRecord(record?.data) ?? record;
      const content = data?.content ?? data?.text ?? data?.body;
      if (typeof content === "string") {
        state.activeContent = content;
        renderEditor();
        renderFiles();
        return;
      }
    }

    const text = await runCommand(`python3 - "${path}" <<'PY'
import pathlib, sys
rel = sys.argv[1]
root = pathlib.Path.cwd().resolve()
target = (root / rel).resolve()
if root not in target.parents and target != root:
    raise SystemExit("outside workspace")
print("${markerBegin}")
print(target.read_text(encoding="utf-8", errors="replace"))
print("${markerEnd}")
PY`);
    state.activeContent = betweenMarkers(text, markerBegin, markerEnd) ?? text;
  } catch (error) {
    state.activeContent = `Unable to read ${path}\n\n${outputText(error)}`;
  }

  renderEditor();
  renderFiles();
}

async function createPlan(): Promise<void> {
  const intent = byId<HTMLTextAreaElement>("adjx-intent").value.trim();
  state.intent = intent;

  if (!intent) {
    setOutput("PLAN BLOCKED", "Describe the change first.");
    return;
  }

  try {
    if (runtimeWindow.adjutorixPower?.createPlan) {
      const result = await runtimeWindow.adjutorixPower.createPlan({
        workspace: state.workspace,
        intent,
        activeFile: state.activeFile,
      });
      setOutput("GOVERNED PLAN CREATED", result);
      log("Plan object created through governed bridge.");
      return;
    }

    const payload = {
      schema: 1,
      kind: "adjutorix.intent.plan",
      workspace: state.workspace,
      activeFile: state.activeFile,
      intent,
      createdAt: new Date().toISOString(),
      apply: "blocked_until_verify",
    };

    window.localStorage.setItem(`adjutorix.plan.${Date.now()}`, JSON.stringify(payload, null, 2));
    setOutput("LOCAL PLAN CREATED", payload);
  } catch (error) {
    setOutput("PLAN FAILED", error);
  }
}

async function saveDraft(): Promise<void> {
  const content = byId<HTMLTextAreaElement>("adjx-editor").value;
  try {
    if (runtimeWindow.adjutorixPower?.saveDraft) {
      const result = await runtimeWindow.adjutorixPower.saveDraft({
        workspace: state.workspace,
        path: state.activeFile,
        content,
      });
      setOutput("DRAFT SAVED", result);
      return;
    }

    window.localStorage.setItem(`adjutorix.draft.${state.activeFile}`, content);
    setOutput("DRAFT SAVED LOCALLY", state.activeFile);
  } catch (error) {
    setOutput("DRAFT FAILED", error);
  }
}

async function feature(action: string): Promise<void> {
  const commands: Record<string, string> = {
    git: "git status --short && git branch --show-current && git log --oneline --max-count=8",
    diff: "git diff --stat && git diff -- . ':(exclude)package-lock.json' | head -1200",
    verify: "pnpm run verify",
    build: "pnpm -r --if-present run build",
    typecheck: "pnpm --filter @adjutorix/app run build:ts",
    tests:
      "pnpm --filter @adjutorix/app exec vitest run tests/renderer/operator_kernel_live_surface_contract.test.ts tests/renderer/operator_surface_spine_contract.test.ts tests/renderer/operator_unified_control_spine_contract.test.ts",
    routes: "find . -maxdepth 5 \\( -name '*route*' -o -name '*router*' -o -name '*ipc*' \\) -not -path './node_modules/*' -not -path './.git/*' | head -300",
    ipc: "grep -R \"ipcMain.handle\\|ipcRenderer.invoke\\|exposeInMainWorld\" packages/adjutorix-app/src configs/ci -n | head -260",
    diagnostics: "find .tmp reports/current -maxdepth 4 -type f 2>/dev/null | sort | tail -160",
    logs: "find ~/Library/Logs -maxdepth 3 -iname '*adjutorix*' -type f 2>/dev/null | head -80",
    package: "bash scripts/app/install-one-adjutorix-app.sh",
  };

  if (action === "scan") {
    await scanWorkspace();
    return;
  }

  if (action === "plan") {
    await createPlan();
    return;
  }

  if (action === "save") {
    await saveDraft();
    return;
  }

  const command = commands[action];
  if (!command) {
    setOutput("UNKNOWN FEATURE", action);
    return;
  }

  const text = await runCommand(command);
  setOutput(action.toUpperCase(), text);
}

function mount(): void {
  document.title = "Adjutorix";
  document.documentElement.dataset.adjutorixRendererBoot = "native-mounted";

  let root = document.getElementById("root");
  if (!root) {
    root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <main class="adjx-native" data-adjutorix-real-workbench="true">
      <aside class="adjx-rail">
        <button class="is-active">⌘</button>
        <button>⌕</button>
        <button>⑂</button>
        <button>✓</button>
        <button>◆</button>
        <button>⚙</button>
      </aside>

      <section class="adjx-explorer">
        <header>
          <strong>EXPLORER</strong>
          <button data-action="scan">Open</button>
        </header>

        <section class="adjx-workspace-card">
          <span>WORKSPACE</span>
          <strong id="adjx-workspace-label">${escapeHtml(state.workspace)}</strong>
          <div>
            <input id="adjx-workspace-input" value="${escapeHtml(state.workspace)}" />
            <button data-action="scan">Load</button>
          </div>
        </section>

        <input id="adjx-search" class="adjx-search" placeholder="Search real files, scripts, configs..." />

        <section class="adjx-start">
          <h2>Start in 3 seconds</h2>
          <p>Open folder, describe change, generate governed plan, verify, save draft.</p>
          <button data-action="scan">Open Folder</button>
        </section>

        <div id="adjx-file-list" class="adjx-file-list"></div>
      </section>

      <section class="adjx-center">
        <header class="adjx-topbar">
          <div>
            <h1>ADJUTORIX</h1>
            <p>operator-grade governed mutation IDE</p>
          </div>
          <input id="adjx-command" placeholder="Ask Adjutorix: change code, generate plan, verify..." />
          <button data-action="git">Git</button>
          <button data-action="verify">Verify</button>
          <button data-action="plan">Plan</button>
        </header>

        <nav class="adjx-tabs">
          <button class="is-active" id="adjx-tab">${escapeHtml(state.activeFile)}</button>
        </nav>

        <section class="adjx-editor-head">
          <strong id="adjx-file-title">${escapeHtml(state.activeFile)}</strong>
          <span>editable governed buffer</span>
        </section>

        <textarea id="adjx-editor" class="adjx-editor">${escapeHtml(state.activeContent)}</textarea>

        <section class="adjx-terminal-shell">
          <header>
            <strong>Terminal</strong>
            <input id="adjx-shell-command" value="git status --short" />
            <button data-shell-run="true">Run</button>
          </header>
          <pre id="adjx-terminal">${escapeHtml(state.terminal.join("\n"))}</pre>
        </section>
      </section>

      <aside class="adjx-agent">
        <nav>
          <button class="is-active">AGENT</button>
          <button>PLAN</button>
          <button>VERIFY</button>
          <button>DIFF</button>
          <button>LEDGER</button>
        </nav>

        <section class="adjx-agent-box">
          <p>ADJUTORIX AGENT</p>
          <h2>Tell it what to change.</h2>
          <textarea id="adjx-intent" placeholder="Example: add barcode validation, refactor scanner flow, update tests, verify before apply..."></textarea>
          <button data-action="plan">Generate governed plan</button>
        </section>

        <section class="adjx-feature-grid">
          <p>ADJUTORIX FEATURES</p>
          <button data-action="scan">Scan</button>
          <button data-action="git">Git</button>
          <button data-action="diff">Diff</button>
          <button data-action="verify">Verify</button>
          <button data-action="build">Build</button>
          <button data-action="typecheck">Typecheck</button>
          <button data-action="tests">Tests</button>
          <button data-action="routes">Routes</button>
          <button data-action="ipc">IPC Map</button>
          <button data-action="diagnostics">Diagnostics</button>
          <button data-action="logs">Logs</button>
          <button data-action="save">Save Draft</button>
          <button data-action="package">Package</button>
        </section>

        <section class="adjx-gate">
          <article><strong>READY</strong><span>Files: <b id="adjx-files-count">0</b></span></article>
          <article><strong>VERIFY</strong><span>Required before mutation</span></article>
          <article><strong>APPLY</strong><span>Blocked until verify</span></article>
        </section>

        <section class="adjx-output-shell">
          <p>FEATURE OUTPUT</p>
          <pre id="adjx-output">${escapeHtml(state.featureOutput)}</pre>
        </section>
      </aside>
    </main>
  `;

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action]"))) {
    button.addEventListener("click", () => {
      void feature(button.dataset.action ?? "");
    });
  }

  byId<HTMLInputElement>("adjx-search").addEventListener("input", renderFiles);

  byId<HTMLButtonElement>("adjx-shell-command").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void runCommand(byId<HTMLInputElement>("adjx-shell-command").value);
    }
  });

  const shellButton = root.querySelector<HTMLButtonElement>("[data-shell-run]");
  shellButton?.addEventListener("click", () => {
    void runCommand(byId<HTMLInputElement>("adjx-shell-command").value);
  });

  byId<HTMLTextAreaElement>("adjx-intent").addEventListener("input", (event) => {
    state.intent = (event.currentTarget as HTMLTextAreaElement).value;
  });

  renderFiles();
  renderEditor();

  window.setTimeout(() => {
    void scanWorkspace();
  }, 250);

  console.log("ADJUTORIX_NATIVE_OPERATOR_IDE_MOUNTED");
}

try {
  mount();
} catch (error) {
  const root = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  root.id = "root";
  root.innerHTML = `
    <main class="adjx-native-fatal">
      <section>
        <p>ADJUTORIX NATIVE BOOT FAILURE</p>
        <h1>Renderer mounted but native IDE failed.</h1>
        <pre>${escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error))}</pre>
      </section>
    </main>
  `;
  console.error("ADJUTORIX_NATIVE_OPERATOR_IDE_FAILED", error);
}
