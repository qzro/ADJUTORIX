import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BridgeApi = {
  openRepository?: () => Promise<unknown>;
  runCommand?: (input: unknown) => Promise<unknown>;
};

type FileEntry = {
  path: string;
  name: string;
  size?: number;
};

type Tab = {
  path: string;
  content: string;
  dirty: boolean;
};

type Task = {
  id: string;
  title: string;
  status: "planned" | "running" | "blocked" | "ready";
};

declare global {
  interface Window {
    adjutorixPower?: BridgeApi;
  }
}

const QUICK_DOC = `# Adjutorix

Open a repository. The explorer must show real files, not command envelopes.

Ask for a change. Generate a governed plan. Run verify before apply.
`;

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function encodeBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function collectStrings(value: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }

  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out, seen));
    return out;
  }

  Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, out, seen));
  return out;
}

function safeText(value: unknown): string {
  const text = collectStrings(value).map((item) => item.trim()).filter(Boolean).join("\n");
  if (text) return text;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pathFromUnknown(value: unknown): string | null {
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();

  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);

    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }

    const record = item as Record<string, unknown>;
    for (const key of ["workspace", "workspacePath", "root", "rootPath", "path", "filePath", "selectedPath"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.startsWith("/")) return candidate;
    }

    queue.push(...Object.values(record));
  }

  return null;
}

function isRealRelativeFileLine(raw: string): boolean {
  const line = raw.trim();

  if (!line) return false;
  if (line.startsWith("/")) return false;
  if (line.startsWith("$ ")) return false;
  if (line.startsWith("{")) return false;
  if (line.endsWith("}")) return false;
  if (line.includes('"path"')) return false;
  if (line.includes('"files"')) return false;
  if (line.includes('":"')) return false;
  if (line.includes('","')) return false;
  if (line.includes("[adjutorix-app]")) return false;
  if (/^(Opening workspace|POWER ENGINE|Command completed|ERROR|Adjutorix ready|Indexed )/.test(line)) return false;
  if (line.length > 240) return false;

  return line.includes("/") || line.startsWith(".") || /\.[A-Za-z0-9_-]{1,16}$/.test(line) || /^[A-Z0-9_-]{3,}$/.test(line);
}

function filesFromLineOutput(value: unknown): FileEntry[] {
  const seen = new Set<string>();
  const files: FileEntry[] = [];

  for (const chunk of collectStrings(value)) {
    for (const raw of chunk.split(/\r?\n/g)) {
      const path = raw.replace(/^\.\//, "").trim();
      if (!isRealRelativeFileLine(path)) continue;
      if (seen.has(path)) continue;

      seen.add(path);
      files.push({ path, name: basename(path) });

      if (files.length >= 1800) return files;
    }
  }

  return files;
}

function preferredFile(files: FileEntry[]): FileEntry | undefined {
  return (
    files.find((file) => file.path === "README.md") ??
    files.find((file) => file.path === "package.json") ??
    files.find((file) => file.path === "src/renderer/App.tsx") ??
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
  const [fileQuery, setFileQuery] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([{ path: "ADJUTORIX.md", content: QUICK_DOC, dirty: false }]);
  const [activePath, setActivePath] = useState("ADJUTORIX.md");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("git status --short");
  const [terminal, setTerminal] = useState<string[]>(["Adjutorix ready. Open a repo or press Scan."]);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([
    { id: "1", title: "Workspace indexed", status: "blocked" },
    { id: "2", title: "Intent captured", status: "planned" },
    { id: "3", title: "Plan object created", status: "planned" },
    { id: "4", title: "Verify before apply", status: "blocked" },
  ]);
  const scannedOnce = useRef(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? tabs[0], [activePath, tabs]);

  const visibleFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    const list = Array.isArray(files) ? files : [];
    if (!query) return list.slice(0, 900);
    return list.filter((file) => file.path.toLowerCase().includes(query)).slice(0, 900);
  }, [fileQuery, files]);

  const log = useCallback((line: string) => {
    setTerminal((current) => [...current.slice(-220), line]);
  }, []);

  const runCommand = useCallback(
    async (nextCommand = command, cwd = workspace): Promise<unknown> => {
      if (!api?.runCommand) {
        log("ERROR: adjutorixPower.runCommand bridge is not exposed.");
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
        log(safeText(result) || "Command completed.");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`ERROR: ${message}`);
        return "";
      } finally {
        setBusy(false);
      }
    },
    [api, command, log, workspace],
  );

  const readFileIntoTab = useCallback(
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

      const result = await runCommand(readCommand, cwd);
      const content = safeText(result);

      setTabs((current) => {
        const exists = current.some((tab) => tab.path === file.path);
        if (exists) {
          return current.map((tab) => (tab.path === file.path ? { ...tab, content, dirty: false } : tab));
        }
        return [...current, { path: file.path, content, dirty: false }];
      });

      setActivePath(file.path);
    },
    [runCommand, workspace],
  );

  const scan = useCallback(
    async (root: string) => {
      const trimmed = root.trim();
      if (!trimmed) {
        log("ERROR: workspace path is empty.");
        return;
      }

      setWorkspace(trimmed);
      setPathInput(trimmed);
      localStorage.setItem("adjutorix.lastWorkspace", trimmed);

      const scanCommand = [
        "find . -maxdepth 6",
        "\\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './release' -o -path './.tmp' -o -path './__pycache__' \\) -prune",
        "-o -type f -print",
        "| sed 's#^./##'",
        "| head -1800",
      ].join(" ");

      log(`Scanning workspace: ${trimmed}`);
      const result = await runCommand(scanCommand, trimmed);
      const nextFiles = filesFromLineOutput(result);

      setFiles(nextFiles);
      setTasks((current) =>
        current.map((task) => (task.id === "1" ? { ...task, status: nextFiles.length ? "ready" : "blocked" } : task)),
      );

      log(`REAL FILE INDEX: ${nextFiles.length} files.`);

      const first = preferredFile(nextFiles);
      if (first) {
        await readFileIntoTab(first, trimmed);
      }
    },
    [log, readFileIntoTab, runCommand],
  );

  useEffect(() => {
    if (workspace && !scannedOnce.current) {
      scannedOnce.current = true;
      void scan(workspace);
    }
  }, [scan, workspace]);

  const openRepository = useCallback(async () => {
    if (!api?.openRepository) {
      log("Open dialog unavailable. Paste a folder path and press Load.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.openRepository();
      const selected = pathFromUnknown(result);
      if (selected) await scan(selected);
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [api, log, scan]);

  const updateActiveTab = useCallback(
    (content: string) => {
      setTabs((current) => current.map((tab) => (tab.path === activePath ? { ...tab, content, dirty: true } : tab)));
    },
    [activePath],
  );

  const saveDraft = useCallback(async () => {
    if (!workspace || !activeTab) {
      log("ERROR: open a workspace and file first.");
      return;
    }

    const encoded = encodeBase64(activeTab.content);
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

    await runCommand(saveCommand, workspace);
    setTabs((current) => current.map((tab) => (tab.path === activeTab.path ? { ...tab, dirty: false } : tab)));
  }, [activeTab, log, runCommand, workspace]);

  const createPlan = useCallback(async () => {
    const body = prompt.trim();
    if (!workspace) {
      log("ERROR: open a workspace first.");
      return;
    }

    if (!body) {
      log("ERROR: describe the change first.");
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === "2" ? { ...task, status: "ready" } : task.id === "3" ? { ...task, status: "running" } : task,
      ),
    );

    const encoded = encodeBase64(body);
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
  'created_by': 'Adjutorix workbench'
}, indent=2), encoding='utf-8')
print(target)
PY`;

    await runCommand(planCommand, workspace);
    setTasks((current) => current.map((task) => (task.id === "3" ? { ...task, status: "ready" } : task)));
  }, [log, prompt, runCommand, workspace]);

  const powerActions = [
    { label: "Scan", run: () => scan(pathInput || workspace) },
    { label: "Git", run: () => runCommand("git status --short") },
    { label: "Diff", run: () => runCommand("git diff --stat && git diff | head -240") },
    { label: "Verify", run: () => runCommand("pnpm run verify") },
    { label: "Build", run: () => runCommand("pnpm -r --if-present run build") },
    { label: "Typecheck", run: () => runCommand("pnpm --filter @adjutorix/app run build:ts") },
    { label: "Tests", run: () => runCommand("pnpm --filter @adjutorix/app exec vitest run") },
    { label: "Routes", run: () => runCommand("grep -R \"ipcMain.handle\\|safeHandle\\|exposeInMainWorld\" -n packages/adjutorix-app/src | head -120") },
    { label: "Save Draft", run: () => saveDraft() },
    { label: "Package", run: () => runCommand("ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh") },
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
          value={fileQuery}
          onChange={(event) => setFileQuery(event.target.value)}
          placeholder="Search files..."
        />

        <div className="adjutorix-cursor-filelist">
          {visibleFiles.length > 0 ? (
            visibleFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={file.path === activePath ? "is-active" : ""}
                onClick={() => void readFileIntoTab(file)}
              >
                <strong>{file.name}</strong>
                <span>{file.path}</span>
              </button>
            ))
          ) : (
            <section className="adjutorix-cursor-empty">
              <h2>Open. Scan. Work.</h2>
              <p>Real file index, editor, terminal, diff, verify, build, test, draft, package.</p>
              <button type="button" onClick={() => void scan(pathInput || workspace)}>Scan Workspace</button>
            </section>
          )}
        </div>
      </aside>

      <main className="adjutorix-cursor-main">
        <header className="adjutorix-cursor-command">
          <div>
            <strong>ADJUTORIX</strong>
            <span>Cursor-class governed agent IDE</span>
          </div>
          <button type="button" onClick={() => void scan(pathInput || workspace)}>Scan</button>
          <button type="button" onClick={() => void runCommand("git status --short")}>Git</button>
          <button type="button" onClick={() => void runCommand("pnpm run verify")}>Verify</button>
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
            onChange={(event) => updateActiveTab(event.target.value)}
          />
        </section>

        <section className="adjutorix-cursor-terminal">
          <header>
            <strong>Terminal</strong>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runCommand();
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
          <button type="button" onClick={() => void runCommand("git diff --stat")}>Diff</button>
          <button type="button" onClick={() => void runCommand("git status --short")}>State</button>
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
          <h3>All features</h3>
          <div>
            {powerActions.map((action) => (
              <button key={action.label} type="button" onClick={() => void action.run()}>
                {action.label}
              </button>
            ))}
          </div>
        </section>

        <section className="adjutorix-cursor-plan">
          <h3>Execution plan</h3>
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
        <span>Apply: blocked until verify</span>
      </footer>
    </section>
  );
}
