import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BridgeApi = {
  openRepository?: () => Promise<unknown>;
  runCommand?: (input: unknown) => Promise<unknown>;
};

type FileEntry = {
  path: string;
  name: string;
};

type Tab = {
  path: string;
  content: string;
  dirty: boolean;
};

type TaskStatus = "ready" | "planned" | "running" | "blocked";

type GateTask = {
  id: string;
  title: string;
  status: TaskStatus;
};

type FeatureKey =
  | "agent"
  | "plan"
  | "verify"
  | "diff"
  | "ledger"
  | "patch"
  | "diagnostics"
  | "kernel"
  | "package"
  | "state";

type BridgeFunction = (...args: unknown[]) => Promise<unknown> | unknown;

function browserBridgeValue(key: string): unknown {
  return (window as unknown as Record<string, unknown>)[key];
}

function powerBridge(): BridgeApi | undefined {
  return browserBridgeValue("adjutorixPower") as BridgeApi | undefined;
}

function adjutorixBridge(): unknown {
  return browserBridgeValue("adjutorix");
}

function adjutorixOperatorKernelBridge(): unknown {
  return browserBridgeValue("adjutorixOperatorKernel");
}

const HOME_DOC = `# ADJUTORIX

Operator-grade governed agent IDE.

Open a repository. Ask for a change. Inspect real files. Edit buffers. Create governed plans. Run verify. Inspect ledger, diagnostics, patch state, IPC, kernel receipts, package posture, and git state from one surface.

Apply stays blocked until the governed verification gate opens.
`;

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function base64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function asJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findBridgeFunction(root: unknown, path: string): BridgeFunction | null {
  let node: unknown = root;

  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[part];
  }

  return typeof node === "function" ? (node as BridgeFunction) : null;
}

function findStringByKey(value: unknown, keys: string[], seen = new Set<unknown>()): string {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findStringByKey(item, keys, seen);
      if (hit) return hit;
    }
    return "";
  }

  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string") return direct;
  }

  for (const nestedKey of ["result", "payload", "data", "value", "body", "response"]) {
    const hit = findStringByKey(record[nestedKey], keys, seen);
    if (hit) return hit;
  }

  for (const item of Object.values(record)) {
    const hit = findStringByKey(item, keys, seen);
    if (hit) return hit;
  }

  return "";
}

function commandStdout(value: unknown): string {
  if (typeof value === "string") return value;
  return findStringByKey(value, ["stdout", "output", "content", "text"]);
}

function commandStderr(value: unknown): string {
  return findStringByKey(value, ["stderr", "error"]);
}

function commandDisplay(value: unknown): string {
  const stdout = commandStdout(value).trimEnd();
  const stderr = commandStderr(value).trimEnd();

  if (stdout && stderr) return `${stdout}\n${stderr}`;
  if (stdout) return stdout;
  if (stderr) return stderr;

  return asJson(value);
}

function selectedPathFromDialog(value: unknown): string {
  const found = findStringByKey(value, ["workspace", "workspacePath", "root", "rootPath", "path", "filePath", "selectedPath"]);
  return found.startsWith("/") ? found : "";
}

function isCleanFileLine(raw: string): boolean {
  const line = raw.trim();

  if (!line) return false;
  if (line.startsWith("/")) return false;
  if (line.startsWith("$ ")) return false;
  if (line.startsWith("{") || line.endsWith("}")) return false;
  if (line.includes('"path"') || line.includes('"files"') || line.includes('":"') || line.includes('","')) return false;
  if (line.includes("[adjutorix-app]")) return false;
  if (/^(Opening workspace|Scanning workspace|REAL FILE INDEX|Command completed|ERROR|ok|true|false)$/i.test(line)) return false;
  if (line.length > 220) return false;

  return line.includes("/") || /^\.[A-Za-z0-9_-]/.test(line) || /\.[A-Za-z0-9_-]{1,16}$/.test(line) || /^[A-Z0-9_.-]{3,}$/.test(line);
}

function filesFromStdout(stdout: string): FileEntry[] {
  const seen = new Set<string>();
  const files: FileEntry[] = [];

  for (const raw of stdout.split(/\r?\n/g)) {
    const path = raw.replace(/^\.\//, "").trim();
    if (!isCleanFileLine(path)) continue;
    if (seen.has(path)) continue;

    seen.add(path);
    files.push({ path, name: basename(path) });

    if (files.length >= 3000) break;
  }

  return files;
}

function firstGoodFile(files: FileEntry[]): FileEntry | undefined {
  return (
    files.find((file) => file.path === "README.md") ??
    files.find((file) => file.path === "package.json") ??
    files.find((file) => file.path.endsWith("App.tsx")) ??
    files.find((file) => file.path.endsWith(".ts")) ??
    files.find((file) => file.path.endsWith(".tsx")) ??
    files.find((file) => file.path.endsWith(".js")) ??
    files[0]
  );
}

export function AdjutorixPowerWorkbench(): JSX.Element {
  const api = powerBridge();

  const [workspace, setWorkspace] = useState(() => localStorage.getItem("adjutorix.lastWorkspace") ?? "");
  const [pathInput, setPathInput] = useState(() => localStorage.getItem("adjutorix.lastWorkspace") ?? "");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([{ path: "ADJUTORIX.md", content: HOME_DOC, dirty: false }]);
  const [activePath, setActivePath] = useState("ADJUTORIX.md");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("git status --short");
  const [terminal, setTerminal] = useState<string[]>(["ADJUTORIX ready. Operator surface online."]);
  const [feature, setFeature] = useState<FeatureKey>("agent");
  const [featureOutput, setFeatureOutput] = useState("No feature call yet.");
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<GateTask[]>([
    { id: "1", title: "Workspace indexed", status: "blocked" },
    { id: "2", title: "Intent captured", status: "planned" },
    { id: "3", title: "Plan object created", status: "planned" },
    { id: "4", title: "Verification gate", status: "blocked" },
    { id: "5", title: "Apply gate", status: "blocked" },
  ]);

  const didAutoScan = useRef(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? tabs[0], [activePath, tabs]);

  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files.slice(0, 1400);
    return files.filter((file) => file.path.toLowerCase().includes(needle)).slice(0, 1400);
  }, [files, query]);

  const log = useCallback((line: string) => {
    setTerminal((current) => [...current.slice(-300), line]);
  }, []);

  const invokeCommand = useCallback(
    async (nextCommand: string, cwd: string, options: { showOutput?: boolean } = {}): Promise<unknown> => {
      if (!api?.runCommand) {
        log("ERROR: adjutorixPower.runCommand bridge missing.");
        return "";
      }

      const trimmed = nextCommand.trim();
      if (!trimmed) return "";

      setBusy(true);
      log(`$ ${trimmed}`);

      try {
        const result = await api.runCommand({
          command: trimmed,
          cwd: cwd || undefined,
          workspace: cwd || undefined,
        });

        if (options.showOutput !== false) {
          const display = commandDisplay(result).trimEnd();
          if (display) log(display);
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`ERROR: ${message}`);
        return "";
      } finally {
        setBusy(false);
      }
    },
    [api, log],
  );

  const invokeAdjutorix = useCallback(
    async (label: string, bridgePath: string, fallbackCommand?: string) => {
      setFeatureOutput(`Running ${label}...`);

      const fn = findBridgeFunction(adjutorixBridge(), bridgePath);

      if (fn) {
        try {
          const result = await fn();
          const rendered = asJson(result);
          setFeatureOutput(rendered);
          log(`${label}: bridge ${bridgePath} returned.`);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeatureOutput(`Bridge ${bridgePath} failed:\n${message}`);
          log(`ERROR: ${label}: ${message}`);
          return "";
        }
      }

      if (fallbackCommand) {
        const result = await invokeCommand(fallbackCommand, workspace, { showOutput: false });
        const rendered = commandDisplay(result);
        setFeatureOutput(rendered);
        log(`${label}: fallback command completed.`);
        return result;
      }

      setFeatureOutput(`Bridge not exposed: ${bridgePath}`);
      return "";
    },
    [invokeCommand, log, workspace],
  );

  const runTerminalCommand = useCallback(
    async (nextCommand = command) => {
      await invokeCommand(nextCommand, workspace, { showOutput: true });
    },
    [command, invokeCommand, workspace],
  );

  const readFile = useCallback(
    async (file: FileEntry, cwd = workspace) => {
      if (!cwd) return;

      const readCommand = `python3 - ${shellQuote(file.path)} <<'PY'
import pathlib, sys
rel=sys.argv[1]
root=pathlib.Path.cwd().resolve()
target=(root / rel).resolve()
if root not in target.parents and target != root:
    raise SystemExit("outside workspace")
print(target.read_text(encoding='utf-8', errors='replace'))
PY`;

      const result = await invokeCommand(readCommand, cwd, { showOutput: false });
      const content = commandStdout(result).replace(/\n$/, "");

      setTabs((current) => {
        const exists = current.some((tab) => tab.path === file.path);
        if (exists) return current.map((tab) => (tab.path === file.path ? { ...tab, content, dirty: false } : tab));
        return [...current, { path: file.path, content, dirty: false }];
      });

      setActivePath(file.path);
      log(`Opened ${file.path}`);
    },
    [invokeCommand, log, workspace],
  );

  const scan = useCallback(
    async (root: string) => {
      const cwd = root.trim();
      if (!cwd) {
        log("ERROR: workspace path is empty.");
        return;
      }

      setWorkspace(cwd);
      setPathInput(cwd);
      localStorage.setItem("adjutorix.lastWorkspace", cwd);

      const scanCommand = [
        "find . -maxdepth 8",
        "\\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './release' -o -path './.tmp' -o -path './__pycache__' \\) -prune",
        "-o -type f -print",
        "| sed 's#^./##'",
        "| head -3000",
      ].join(" ");

      log(`Scanning ${cwd}`);
      const result = await invokeCommand(scanCommand, cwd, { showOutput: false });
      const indexed = filesFromStdout(commandStdout(result));

      setFiles(indexed);
      setTasks((current) => current.map((task) => (task.id === "1" ? { ...task, status: indexed.length ? "ready" : "blocked" } : task)));
      log(`REAL FILE INDEX READY: ${indexed.length} files`);

      const first = firstGoodFile(indexed);
      if (first) await readFile(first, cwd);
    },
    [invokeCommand, log, readFile],
  );

  useEffect(() => {
    if (workspace && !didAutoScan.current) {
      didAutoScan.current = true;
      void scan(workspace);
    }
  }, [scan, workspace]);

  const openRepository = useCallback(async () => {
    if (!api?.openRepository) {
      log("Open dialog missing. Paste path and press Load.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.openRepository();
      const selected = selectedPathFromDialog(result);
      if (selected) await scan(selected);
    } finally {
      setBusy(false);
    }
  }, [api, log, scan]);

  const updateBuffer = useCallback(
    (content: string) => {
      setTabs((current) => current.map((tab) => (tab.path === activePath ? { ...tab, content, dirty: true } : tab)));
    },
    [activePath],
  );

  const saveDraft = useCallback(async () => {
    if (!workspace || !activeTab) {
      log("ERROR: open workspace and file first.");
      return;
    }

    const encoded = base64(activeTab.content);
    const saveCommand = `python3 - ${shellQuote(activeTab.path)} ${shellQuote(encoded)} <<'PY'
import base64, pathlib, sys, time
path=sys.argv[1]
body=base64.b64decode(sys.argv[2]).decode('utf-8', errors='replace')
root=pathlib.Path.cwd()
out=root/'.adjutorix'/'workbench-drafts'
out.mkdir(parents=True, exist_ok=True)
target=out/f"{int(time.time())}__{path.replace('/', '__')}"
target.write_text(body, encoding='utf-8')
print(target)
PY`;

    await invokeCommand(saveCommand, workspace, { showOutput: true });
    setTabs((current) => current.map((tab) => (tab.path === activeTab.path ? { ...tab, dirty: false } : tab)));
  }, [activeTab, invokeCommand, log, workspace]);

  const createPlan = useCallback(async () => {
    const intent = prompt.trim();

    if (!workspace) {
      log("ERROR: open workspace first.");
      return;
    }

    if (!intent) {
      log("ERROR: describe what Adjutorix should change.");
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === "2" ? { ...task, status: "ready" } :
        task.id === "3" ? { ...task, status: "running" } :
        task,
      ),
    );

    const encoded = base64(intent);
    const planCommand = `python3 - ${shellQuote(encoded)} <<'PY'
import base64, json, pathlib, sys, time
intent=base64.b64decode(sys.argv[1]).decode('utf-8', errors='replace')
root=pathlib.Path.cwd()
out=root/'.adjutorix'/'objects'
out.mkdir(parents=True, exist_ok=True)
target=out/f'intent-plan-{int(time.time())}.json'
target.write_text(json.dumps({
  'schema': 'adjutorix.intent_plan.v1',
  'intent': intent,
  'status': 'VERIFY_REQUIRED_BEFORE_APPLY',
  'created_by': 'Adjutorix operator-grade agent IDE'
}, indent=2), encoding='utf-8')
print(target)
PY`;

    const result = await invokeCommand(planCommand, workspace, { showOutput: true });
    setFeature("plan");
    setFeatureOutput(commandDisplay(result));
    setTasks((current) => current.map((task) => (task.id === "3" ? { ...task, status: "ready" } : task)));
  }, [invokeCommand, log, prompt, workspace]);

  const actionGroups: Record<FeatureKey, Array<{ label: string; run: () => void }>> = {
    agent: [
      { label: "Agent health", run: () => void invokeAdjutorix("Agent health", "agent.health", "echo agent-health-fallback") },
      { label: "Agent status", run: () => void invokeAdjutorix("Agent status", "agent.status", "echo agent-status-fallback") },
      { label: "Start agent", run: () => void invokeAdjutorix("Start agent", "agent.start", "echo agent-start-fallback") },
      { label: "Stop agent", run: () => void invokeAdjutorix("Stop agent", "agent.stop", "echo agent-stop-fallback") },
      { label: "Runtime snapshot", run: () => void invokeAdjutorix("Runtime snapshot", "runtime.snapshot", "node -e \"console.log(JSON.stringify(process.versions,null,2))\"") },
    ],
    plan: [
      { label: "Create plan", run: () => void createPlan() },
      { label: "List plans", run: () => void invokeAdjutorix("List plans", "ledger.timeline", "find .adjutorix -type f 2>/dev/null | sort | tail -80") },
      { label: "Save draft", run: () => void saveDraft() },
    ],
    verify: [
      { label: "Verify run", run: () => void invokeAdjutorix("Verify run", "verify.run", "pnpm run verify") },
      { label: "Verify status", run: () => void invokeAdjutorix("Verify status", "verify.status", "find reports/current -type f 2>/dev/null | sort | tail -80") },
      { label: "Verify clear", run: () => void invokeAdjutorix("Verify clear", "verify.clearState", "echo verify-clear-fallback") },
    ],
    diff: [
      { label: "Git status", run: () => void runTerminalCommand("git status --short") },
      { label: "Diff stat", run: () => void invokeAdjutorix("Diff stat", "patch.preview", "git diff --stat") },
      { label: "Diff body", run: () => void invokeAdjutorix("Diff body", "patch.preview", "git diff | head -260") },
    ],
    ledger: [
      { label: "Ledger timeline", run: () => void invokeAdjutorix("Ledger timeline", "ledger.timeline", "find .adjutorix reports/current -type f 2>/dev/null | sort | tail -120") },
      { label: "Ledger stats", run: () => void invokeAdjutorix("Ledger stats", "ledger.stats", "find .adjutorix reports/current -type f 2>/dev/null | wc -l") },
      { label: "Ledger heads", run: () => void invokeAdjutorix("Ledger heads", "ledger.heads", "find reports/current -maxdepth 1 -type f 2>/dev/null | sort | tail -60") },
    ],
    patch: [
      { label: "Patch preview", run: () => void invokeAdjutorix("Patch preview", "patch.preview", "git diff --stat && git diff | head -260") },
      { label: "Approve preview", run: () => void invokeAdjutorix("Approve preview", "patch.approvePreview", "echo approve-preview-requires-verified-state") },
      { label: "Bind verify", run: () => void invokeAdjutorix("Bind verify", "patch.bindVerify", "echo bind-verify-fallback") },
      { label: "Clear patch", run: () => void invokeAdjutorix("Clear patch", "patch.clearPreviewState", "echo clear-patch-fallback") },
    ],
    diagnostics: [
      { label: "Runtime diagnostics", run: () => void invokeAdjutorix("Runtime diagnostics", "diagnostics.runtimeSnapshot", "find .tmp reports/current -type f 2>/dev/null | head -120") },
      { label: "Startup report", run: () => void invokeAdjutorix("Startup report", "diagnostics.startupReport", "find .tmp -type f 2>/dev/null | head -120") },
      { label: "Log tail", run: () => void invokeAdjutorix("Log tail", "diagnostics.logTail", "find . -name '*.log' -type f 2>/dev/null | head -80") },
      { label: "Observability", run: () => void invokeAdjutorix("Observability", "diagnostics.observabilityBundle", "find configs reports/current -type f 2>/dev/null | head -160") },
    ],
    kernel: [
      { label: "Kernel object", run: () => { setFeatureOutput(asJson(adjutorixOperatorKernelBridge() ?? "adjutorixOperatorKernel bridge not exposed")); } },
      { label: "Create receipt", run: () => void invokeAdjutorix("Create receipt", "operatorKernel.createReceipt", "mkdir -p .adjutorix/operator-kernel && date +%s > .adjutorix/operator-kernel/receipt.txt && cat .adjutorix/operator-kernel/receipt.txt") },
      { label: "Last hash", run: () => void invokeAdjutorix("Last hash", "operatorKernel.lastHash", "find .adjutorix -type f 2>/dev/null | xargs shasum 2>/dev/null | tail -20") },
    ],
    package: [
      { label: "Install app", run: () => void runTerminalCommand("ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh") },
      { label: "Build package", run: () => void runTerminalCommand("pnpm -r --if-present run build") },
      { label: "App resources", run: () => void runTerminalCommand("find /Applications/Adjutorix.app/Contents/Resources -maxdepth 5 -type f | head -120") },
    ],
    state: [
      { label: "Git state", run: () => void invokeAdjutorix("Git state", "runtime.snapshot", "git status --short && git branch --show-current") },
      { label: "IPC map", run: () => void runTerminalCommand("grep -R \"ipcMain.handle\\|safeHandle\\|exposeInMainWorld\" -n packages/adjutorix-app/src | head -180") },
      { label: "Repository map", run: () => void runTerminalCommand("find packages scripts configs docs -maxdepth 3 -type f | sort | head -260") },
    ],
  };

  const featureTabs: Array<{ id: FeatureKey; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "plan", label: "Plan" },
    { id: "verify", label: "Verify" },
    { id: "diff", label: "Diff" },
    { id: "ledger", label: "Ledger" },
    { id: "patch", label: "Patch" },
    { id: "diagnostics", label: "Diagnostics" },
    { id: "kernel", label: "Kernel" },
    { id: "package", label: "Package" },
    { id: "state", label: "State" },
  ];

  return (
    <section className="adjutorix-operator-ide" data-busy={busy ? "true" : "false"}>
      <aside className="adjutorix-operator-rail">
        <button className="is-active" type="button">⌘</button>
        <button type="button">⌕</button>
        <button type="button">⑂</button>
        <button type="button">✓</button>
        <button type="button">◆</button>
        <button type="button">⚙</button>
      </aside>

      <aside className="adjutorix-operator-explorer">
        <header>
          <strong>Explorer</strong>
          <button type="button" onClick={() => void openRepository()}>Open</button>
        </header>

        <section className="adjutorix-operator-workspace">
          <span>Workspace</span>
          <strong>{workspace || "No folder open"}</strong>
          <div>
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void scan(pathInput);
              }}
              placeholder="/Users/.../project"
            />
            <button type="button" onClick={() => void scan(pathInput)}>Load</button>
          </div>
        </section>

        <input
          className="adjutorix-operator-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files, scripts, configs..."
        />

        <div className="adjutorix-operator-filelist">
          {visibleFiles.length ? (
            visibleFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={file.path === activePath ? "is-active" : ""}
                onClick={() => void readFile(file)}
              >
                <strong>{file.name}</strong>
                <span>{file.path}</span>
              </button>
            ))
          ) : (
            <section className="adjutorix-operator-empty">
              <h2>Start in 3 seconds</h2>
              <p>Open folder. Scan. Tell Adjutorix what to change. Verify before apply.</p>
              <button type="button" onClick={() => void scan(pathInput || workspace)}>Scan Workspace</button>
            </section>
          )}
        </div>
      </aside>

      <main className="adjutorix-operator-main">
        <header className="adjutorix-operator-topbar">
          <div>
            <strong>ADJUTORIX</strong>
            <span>operator-grade governed agent IDE</span>
          </div>

          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createPlan();
            }}
            placeholder="Ask Adjutorix: change code, generate plan, verify, package..."
          />

          <button type="button" onClick={() => void createPlan()}>Plan</button>
          <button type="button" onClick={() => void runTerminalCommand("pnpm run verify")}>Verify</button>
          <button type="button" onClick={() => void runTerminalCommand("git status --short")}>State</button>
        </header>

        <nav className="adjutorix-operator-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.path}
              className={tab.path === activePath ? "is-active" : ""}
              type="button"
              onClick={() => setActivePath(tab.path)}
            >
              {basename(tab.path)}{tab.dirty ? " •" : ""}
            </button>
          ))}
        </nav>

        <section className="adjutorix-operator-editor">
          <header>
            <span>{activeTab?.path ?? "No file"}</span>
            <em>editable governed buffer</em>
          </header>
          <textarea
            spellCheck={false}
            value={activeTab?.content ?? ""}
            onChange={(event) => updateBuffer(event.target.value)}
          />
        </section>

        <section className="adjutorix-operator-terminal">
          <header>
            <strong>Terminal</strong>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runTerminalCommand();
              }}
              placeholder="Run command..."
            />
          </header>
          <div>
            {terminal.map((line, index) => (
              <pre key={index}>{line}</pre>
            ))}
          </div>
        </section>
      </main>

      <aside className="adjutorix-operator-sidecar">
        <nav>
          {featureTabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === feature ? "is-active" : ""}
              type="button"
              onClick={() => setFeature(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className="adjutorix-operator-agent">
          <p>ADJUTORIX AGENT</p>
          <h2>Tell it what to change.</h2>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: add barcode validation, refactor scanner flow, update tests, verify before apply..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Generate governed plan
          </button>
        </section>

        <section className="adjutorix-operator-feature-actions">
          <h3>{feature.toUpperCase()}</h3>
          <div>
            {actionGroups[feature].map((action) => (
              <button key={action.label} type="button" onClick={() => action.run()}>
                {action.label}
              </button>
            ))}
          </div>
        </section>

        <section className="adjutorix-operator-feature-output">
          <h3>Feature output</h3>
          <pre>{featureOutput}</pre>
        </section>

        <section className="adjutorix-operator-gate">
          <h3>Governed gate</h3>
          {tasks.map((task) => (
            <article key={task.id} data-status={task.status}>
              <span>{task.id}</span>
              <strong>{task.title}</strong>
              <em>{task.status}</em>
            </article>
          ))}
        </section>
      </aside>

      <footer className="adjutorix-operator-status">
        <span>Adjutorix</span>
        <span>{workspace || "No workspace"}</span>
        <span>Files: {files.length}</span>
        <span>Bridge: connected</span>
        <span>Verify: required</span>
        <span>Apply: blocked</span>
      </footer>
    </section>
  );
}
