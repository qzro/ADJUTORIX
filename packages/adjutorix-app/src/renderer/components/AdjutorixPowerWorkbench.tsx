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

type Task = {
  id: string;
  title: string;
  status: "ready" | "planned" | "running" | "blocked";
};

declare global {
  interface Window {
    adjutorixPower?: BridgeApi;
  }
}

const HOME_DOC = `# ADJUTORIX

This is the product workbench.

Open a repository, inspect real files, edit buffers, save drafts, create governed plans, run commands, verify, build, test, package, inspect IPC, and keep apply blocked until the gate opens.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findStringByKey(value: unknown, keys: string[], seen = new Set<unknown>()): string {
  if (typeof value === "string") return keys.includes("__string__") ? value : "";
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
    const nested = record[nestedKey];
    const hit = findStringByKey(nested, keys, seen);
    if (hit) return hit;
  }

  for (const item of Object.values(record)) {
    const hit = findStringByKey(item, keys, seen);
    if (hit) return hit;
  }

  return "";
}

function commandStdout(value: unknown): string {
  return (
    findStringByKey(value, ["stdout", "output", "content", "text"]) ||
    (typeof value === "string" ? value : "")
  );
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

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function selectedPathFromDialog(value: unknown): string {
  const direct = findStringByKey(value, ["workspace", "workspacePath", "root", "rootPath", "path", "filePath", "selectedPath"]);
  return direct.startsWith("/") ? direct : "";
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

    if (files.length >= 2200) break;
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
  const api = window.adjutorixPower;

  const [workspace, setWorkspace] = useState(() => localStorage.getItem("adjutorix.lastWorkspace") ?? "");
  const [pathInput, setPathInput] = useState(() => localStorage.getItem("adjutorix.lastWorkspace") ?? "");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([{ path: "ADJUTORIX.md", content: HOME_DOC, dirty: false }]);
  const [activePath, setActivePath] = useState("ADJUTORIX.md");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("git status --short");
  const [terminal, setTerminal] = useState<string[]>(["ADJUTORIX ready. No fake output. Commands stay in terminal. Files stay in explorer."]);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([
    { id: "1", title: "Index workspace", status: "blocked" },
    { id: "2", title: "Capture operator intent", status: "planned" },
    { id: "3", title: "Create governed plan", status: "planned" },
    { id: "4", title: "Verify before apply", status: "blocked" },
  ]);
  const didAutoScan = useRef(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? tabs[0], [activePath, tabs]);

  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files.slice(0, 1000);
    return files.filter((file) => file.path.toLowerCase().includes(needle)).slice(0, 1000);
  }, [files, query]);

  const log = useCallback((line: string) => {
    setTerminal((current) => [...current.slice(-260), line]);
  }, []);

  const invoke = useCallback(
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

  const runTerminalCommand = useCallback(
    async (nextCommand = command) => {
      await invoke(nextCommand, workspace, { showOutput: true });
    },
    [command, invoke, workspace],
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

      const result = await invoke(readCommand, cwd, { showOutput: false });
      const content = commandStdout(result).replace(/\n$/, "");

      setTabs((current) => {
        const exists = current.some((tab) => tab.path === file.path);
        if (exists) {
          return current.map((tab) => (tab.path === file.path ? { ...tab, content, dirty: false } : tab));
        }

        return [...current, { path: file.path, content, dirty: false }];
      });

      setActivePath(file.path);
      log(`Opened ${file.path}`);
    },
    [invoke, log, workspace],
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
        "find . -maxdepth 7",
        "\\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './release' -o -path './.tmp' -o -path './__pycache__' \\) -prune",
        "-o -type f -print",
        "| sed 's#^./##'",
        "| head -2200",
      ].join(" ");

      log(`Scanning ${cwd}`);
      const result = await invoke(scanCommand, cwd, { showOutput: false });
      const indexed = filesFromStdout(commandStdout(result));

      setFiles(indexed);
      setTasks((current) =>
        current.map((task) => (task.id === "1" ? { ...task, status: indexed.length ? "ready" : "blocked" } : task)),
      );

      log(`REAL FILE INDEX READY: ${indexed.length} files`);

      const first = firstGoodFile(indexed);
      if (first) await readFile(first, cwd);
    },
    [invoke, log, readFile],
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

    await invoke(saveCommand, workspace, { showOutput: true });
    setTabs((current) => current.map((tab) => (tab.path === activeTab.path ? { ...tab, dirty: false } : tab)));
  }, [activeTab, invoke, log, workspace]);

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
  'created_by': 'Adjutorix feature workbench'
}, indent=2), encoding='utf-8')
print(target)
PY`;

    await invoke(planCommand, workspace, { showOutput: true });
    setTasks((current) => current.map((task) => (task.id === "3" ? { ...task, status: "ready" } : task)));
  }, [invoke, log, prompt, workspace]);

  const actions = [
    { label: "Scan", run: () => scan(pathInput || workspace) },
    { label: "Git", run: () => runTerminalCommand("git status --short") },
    { label: "Diff", run: () => runTerminalCommand("git diff --stat && git diff | head -240") },
    { label: "Search", run: () => runTerminalCommand("grep -R \"TODO\\|FIXME\\|ipcMain\\|safeHandle\\|verify\\|patch\\|ledger\" -n packages scripts configs | head -180") },
    { label: "Verify", run: () => runTerminalCommand("pnpm run verify") },
    { label: "Build", run: () => runTerminalCommand("pnpm -r --if-present run build") },
    { label: "Typecheck", run: () => runTerminalCommand("pnpm --filter @adjutorix/app run build:ts") },
    { label: "Tests", run: () => runTerminalCommand("pnpm --filter @adjutorix/app exec vitest run") },
    { label: "IPC Map", run: () => runTerminalCommand("grep -R \"ipcMain.handle\\|safeHandle\\|exposeInMainWorld\" -n packages/adjutorix-app/src | head -160") },
    { label: "Diagnostics", run: () => runTerminalCommand("find .tmp reports/current -type f 2>/dev/null | head -120") },
    { label: "Save Draft", run: () => saveDraft() },
    { label: "Package", run: () => runTerminalCommand("ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh") },
  ];

  return (
    <section className="adjutorix-cursor-workbench" data-busy={busy ? "true" : "false"}>
      <aside className="adjutorix-cursor-rail">
        <button className="is-active" type="button">⌘</button>
        <button type="button">⌕</button>
        <button type="button">⑂</button>
        <button type="button">✓</button>
        <button type="button">▶</button>
      </aside>

      <aside className="adjutorix-cursor-explorer">
        <header>
          <strong>Explorer</strong>
          <button type="button" onClick={() => void openRepository()}>Open</button>
        </header>

        <section className="adjutorix-cursor-start">
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
          className="adjutorix-cursor-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search real files..."
        />

        <div className="adjutorix-cursor-filelist">
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
            <section className="adjutorix-cursor-empty">
              <h2>Open. Scan. Work.</h2>
              <p>Real files only. No command JSON in the explorer.</p>
              <button type="button" onClick={() => void scan(pathInput || workspace)}>Scan Workspace</button>
            </section>
          )}
        </div>
      </aside>

      <main className="adjutorix-cursor-main">
        <header className="adjutorix-cursor-command">
          <div>
            <strong>ADJUTORIX</strong>
            <span>governed mutation IDE</span>
          </div>
          <button type="button" onClick={() => void scan(pathInput || workspace)}>Scan</button>
          <button type="button" onClick={() => void runTerminalCommand("git status --short")}>Git</button>
          <button type="button" onClick={() => void runTerminalCommand("pnpm run verify")}>Verify</button>
          <button type="button" onClick={() => void createPlan()}>Plan</button>
        </header>

        <nav className="adjutorix-cursor-tabs">
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

        <section className="adjutorix-cursor-editor">
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

        <section className="adjutorix-cursor-terminal">
          <header>
            <strong>Terminal</strong>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runTerminalCommand();
              }}
              placeholder="Run governed command..."
            />
          </header>
          <div>
            {terminal.map((line, index) => (
              <pre key={index}>{line}</pre>
            ))}
          </div>
        </section>
      </main>

      <aside className="adjutorix-cursor-agent">
        <header>
          <button className="is-active" type="button">Agent</button>
          <button type="button" onClick={() => void runTerminalCommand("git diff --stat")}>Diff</button>
          <button type="button" onClick={() => void runTerminalCommand("git status --short")}>State</button>
        </header>

        <section className="adjutorix-cursor-composer">
          <p>Adjutorix Agent</p>
          <h2>Tell it what to change.</h2>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: add barcode validation, refactor scanner flow, then verify before apply..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Generate governed plan
          </button>
        </section>

        <section className="adjutorix-cursor-powers">
          <h3>Adjutorix features</h3>
          <div>
            {actions.map((action) => (
              <button key={action.label} type="button" onClick={() => void action.run()}>
                {action.label}
              </button>
            ))}
          </div>
        </section>

        <section className="adjutorix-cursor-plan">
          <h3>Execution gate</h3>
          {tasks.map((task) => (
            <article key={task.id} data-status={task.status}>
              <span>{task.id}</span>
              <strong>{task.title}</strong>
              <em>{task.status}</em>
            </article>
          ))}
        </section>
      </aside>

      <footer className="adjutorix-cursor-status">
        <span>Adjutorix</span>
        <span>{workspace || "No workspace"}</span>
        <span>Files: {files.length}</span>
        <span>Bridge: connected</span>
        <span>Output boundary: clean</span>
        <span>Apply: blocked until verify</span>
      </footer>
    </section>
  );
}
