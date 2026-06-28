import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BridgeApi = {
  openRepository?: () => Promise<unknown>;
  scanWorkspace?: (workspace: string) => Promise<unknown>;
  readFile?: (input: unknown) => Promise<unknown>;
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
  status: "planned" | "verifying" | "blocked" | "ready";
};

declare global {
  interface Window {
    adjutorixPower?: BridgeApi;
  }
}

const QUICK_DOC = `# Adjutorix

Ask for a change. Inspect files. Generate a plan. Run verification. Keep apply blocked until the governed gate opens.

This is the working surface, not the governance report.
`;

function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const parts = ["stdout", "stderr", "output", "text", "message", "result"]
    .map((key) => record[key])
    .filter((item): item is string => typeof item === "string");
  if (parts.length) return parts.join("\n");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
    for (const key of ["workspace", "workspacePath", "root", "rootPath", "path", "filePath"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.startsWith("/")) return candidate;
    }

    queue.push(...Object.values(record));
  }

  return null;
}

function filesFromResult(value: unknown): FileEntry[] {
  const text = safeText(value);
  const jsonCandidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;

  try {
    const parsed = JSON.parse(jsonCandidate) as { files?: FileEntry[] };
    return Array.isArray(parsed.files)
      ? parsed.files.filter((file) => file && typeof file.path === "string")
      : [];
  } catch {
    return [];
  }
}

function basename(path: string): string {
  return path.split("/").pop() || path;
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
  const [terminal, setTerminal] = useState<string[]>(["Adjutorix ready. Open a folder or ask for a change."]);
  const [tasks, setTasks] = useState<Task[]>([
    { id: "1", title: "Open repository", status: "ready" },
    { id: "2", title: "Describe desired change", status: "planned" },
    { id: "3", title: "Create plan object", status: "planned" },
    { id: "4", title: "Verify before apply", status: "blocked" },
  ]);
  const [busy, setBusy] = useState(false);
  const scannedOnce = useRef(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? tabs[0], [activePath, tabs]);

  const visibleFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    const list = Array.isArray(files) ? files : [];
    if (!query) return list.slice(0, 700);
    return list.filter((file) => file.path.toLowerCase().includes(query)).slice(0, 700);
  }, [fileQuery, files]);

  const log = useCallback((line: string) => {
    setTerminal((current) => [...current.slice(-220), line]);
  }, []);

  const runCommand = useCallback(
    async (nextCommand = command, cwd = workspace) => {
      if (!api?.runCommand) {
        log("Bridge unavailable: runCommand is not exposed.");
        return "";
      }

      const trimmed = nextCommand.trim();
      if (!trimmed) return "";

      setBusy(true);
      log(`$ ${trimmed}`);

      try {
        const result = await api.runCommand({
          command: trimmed,
          ...(cwd ? { cwd } : {}),
        });
        const text = safeText(result);
        log(text || "Command completed.");
        return text;
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

  const scan = useCallback(
    async (root: string) => {
      const trimmed = root.trim();
      if (!trimmed) return;

      setBusy(true);
      setWorkspace(trimmed);
      setPathInput(trimmed);
      localStorage.setItem("adjutorix.lastWorkspace", trimmed);
      log(`Opening workspace: ${trimmed}`);

      const scanCommand = `python3 - <<'PY'
import json, os
skip={'.git','node_modules','dist','release','.tmp','__pycache__','.DS_Store'}
files=[]
root=os.getcwd()
for base, dirs, names in os.walk(root):
    dirs[:] = [d for d in dirs if d not in skip]
    relbase=os.path.relpath(base, root)
    depth=0 if relbase=='.' else relbase.count(os.sep)+1
    if depth > 5:
        dirs[:] = []
        continue
    for name in names:
        if name in skip:
            continue
        full=os.path.join(base,name)
        rel=os.path.relpath(full, root)
        try:
            size=os.path.getsize(full)
        except OSError:
            size=0
        files.append({'path': rel, 'name': name, 'size': size})
        if len(files) >= 1600:
            break
    if len(files) >= 1600:
        break
print(json.dumps({'files': files}, separators=(',', ':')))
PY`;

      try {
        const result = await api?.runCommand?.({ command: scanCommand, cwd: trimmed });
        const nextFiles = filesFromResult(result);
        setFiles(nextFiles);
        log(`Indexed ${nextFiles.length} files.`);
      } catch (error) {
        log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [api, log],
  );

  useEffect(() => {
    if (workspace && !scannedOnce.current) {
      scannedOnce.current = true;
      void scan(workspace);
    }
  }, [scan, workspace]);

  const openRepository = useCallback(async () => {
    if (!api?.openRepository) {
      log("Open dialog unavailable. Paste a folder path and press Enter.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.openRepository();
      const selected = pathFromUnknown(result);
      if (selected) {
        await scan(selected);
      } else {
        log("No folder selected.");
      }
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [api, log, scan]);

  const openFile = useCallback(
    async (file: FileEntry) => {
      if (!workspace) return;

      const readCommand = `python3 - ${shellQuote(file.path)} <<'PY'
import pathlib, sys
rel=sys.argv[1]
root=pathlib.Path.cwd().resolve()
target=(root / rel).resolve()
if root not in target.parents and target != root:
    raise SystemExit("outside workspace")
print(target.read_text(encoding='utf-8', errors='replace'))
PY`;

      const text = await runCommand(readCommand, workspace);
      setTabs((current) => {
        const exists = current.some((tab) => tab.path === file.path);
        if (exists) {
          return current.map((tab) => (tab.path === file.path ? { ...tab, content: text, dirty: false } : tab));
        }
        return [...current, { path: file.path, content: text, dirty: false }];
      });
      setActivePath(file.path);
    },
    [runCommand, workspace],
  );

  const updateActiveTab = useCallback(
    (content: string) => {
      setTabs((current) =>
        current.map((tab) => (tab.path === activePath ? { ...tab, content, dirty: true } : tab)),
      );
    },
    [activePath],
  );

  const createPlan = useCallback(async () => {
    const body = prompt.trim();
    if (!workspace) {
      log("Open a repository before creating a plan.");
      return;
    }
    if (!body) {
      log("Describe the change first.");
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === "3" ? { ...task, status: "ready" } : task.id === "4" ? { ...task, status: "blocked" } : task,
      ),
    );

    const encoded = btoa(unescape(encodeURIComponent(body)));
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
  'created_by': 'Adjutorix Cursor-class workbench'
}, indent=2), encoding='utf-8')
print(target)
PY`;

    await runCommand(planCommand, workspace);
  }, [log, prompt, runCommand, workspace]);

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
          {visibleFiles.length ? (
            visibleFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={file.path === activePath ? "is-active" : ""}
                onClick={() => void openFile(file)}
              >
                <strong>{basename(file.path)}</strong>
                <span>{file.path}</span>
              </button>
            ))
          ) : (
            <section className="adjutorix-cursor-empty">
              <h2>Start in 3 seconds</h2>
              <p>Open a folder, ask for a change, run verify, save drafts.</p>
              <button type="button" onClick={() => void openRepository()}>Open Folder</button>
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
          <button type="button" onClick={() => void runCommand("git status --short")}>Git Status</button>
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
            placeholder="Example: make the scanner flow faster, add validation, then verify before apply..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Generate governed plan
          </button>
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
