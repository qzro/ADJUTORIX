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

Ask for a change. Inspect files. Generate a plan. Run verification. Keep apply blocked until the governed gate opens.

This is the working surface, not the governance report.
`;

function collectStrings(value: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }

  if (!value || typeof value !== "object" || seen.has(value)) {
    return out;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out, seen));
    return out;
  }

  Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, out, seen));
  return out;
}

function safeText(value: unknown): string {
  const parts = collectStrings(value).map((item) => item.trim()).filter(Boolean);

  if (parts.length > 0) {
    return parts.join("\n");
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function normalizeFilePath(path: string): string {
  return path.replace(/^\.\//, "").trim();
}

function pathFromUnknown(value: unknown): string | null {
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
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

function filesFromResult(value: unknown): FileEntry[] {
  const chunks = collectStrings(value).map((text) => text.trim()).filter(Boolean);
  const jsonCandidates: string[] = [];

  for (const chunk of chunks) {
    jsonCandidates.push(chunk);
    const match = chunk.match(/\{[\s\S]*\}/);
    if (match) jsonCandidates.push(match[0]);
  }

  for (const candidate of jsonCandidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as { files?: unknown };
      if (Array.isArray(parsed.files)) {
        return parsed.files
          .filter((file): file is FileEntry => Boolean(file) && typeof (file as FileEntry).path === "string")
          .map((file) => ({
            path: normalizeFilePath(file.path),
            name: typeof file.name === "string" ? file.name : basename(file.path),
            size: typeof file.size === "number" ? file.size : undefined,
          }));
      }
    } catch {
      // Continue to line parsing.
    }
  }

  return chunks
    .flatMap((chunk) => chunk.split(/\r?\n/g))
    .map(normalizeFilePath)
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith("$ ")) return false;
      if (line.startsWith("ERROR")) return false;
      if (line.includes("Command completed")) return false;
      if (line.includes("[adjutorix-app]")) return false;
      return line.includes("/") || /\.[A-Za-z0-9]{1,12}$/.test(line);
    })
    .slice(0, 1600)
    .map((path) => ({ path, name: basename(path) }));
}

function b64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
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
  const [terminal, setTerminal] = useState<string[]>(["Adjutorix power engine ready."]);
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
    const source = Array.isArray(files) ? files : [];
    if (!query) return source.slice(0, 900);
    return source.filter((file) => file.path.toLowerCase().includes(query)).slice(0, 900);
  }, [fileQuery, files]);

  const log = useCallback((line: string) => {
    setTerminal((current) => [...current.slice(-260), line]);
  }, []);

  const runCommand = useCallback(
    async (nextCommand = command, cwd = workspace): Promise<string> => {
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
      if (!trimmed) {
        log("ERROR: workspace path is empty.");
        return;
      }

      setWorkspace(trimmed);
      setPathInput(trimmed);
      localStorage.setItem("adjutorix.lastWorkspace", trimmed);
      setBusy(true);
      log(`Opening workspace: ${trimmed}`);

      const jsonScan = `python3 - <<'PY'
import json, os
skip={'.git','node_modules','dist','release','.tmp','__pycache__','.DS_Store'}
files=[]
root=os.getcwd()
for base, dirs, names in os.walk(root):
    dirs[:] = [d for d in dirs if d not in skip]
    relbase=os.path.relpath(base, root)
    depth=0 if relbase=='.' else relbase.count(os.sep)+1
    if depth > 6:
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
        if len(files) >= 1800:
            break
    if len(files) >= 1800:
        break
print(json.dumps({'files': files}, separators=(',', ':')))
PY`;

      try {
        const text = await runCommand(jsonScan, trimmed);
        let nextFiles = filesFromResult(text);

        if (nextFiles.length === 0) {
          const fallback = await runCommand(
            "find . -maxdepth 6 -type f | sed 's#^./##' | grep -v '^.git/' | grep -v '^node_modules/' | grep -v '^dist/' | grep -v '^release/' | head -1800",
            trimmed,
          );
          nextFiles = filesFromResult(fallback);
        }

        setFiles(nextFiles);
        setTasks((current) =>
          current.map((task) => (task.id === "1" ? { ...task, status: nextFiles.length > 0 ? "ready" : "blocked" } : task)),
        );
        log(`POWER ENGINE INDEXED ${nextFiles.length} FILES.`);
      } catch (error) {
        log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [log, runCommand],
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

  const saveDraft = useCallback(async () => {
    if (!workspace || !activeTab) {
      log("ERROR: open a workspace and file first.");
      return;
    }

    const encoded = b64(activeTab.content);
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
      log("ERROR: open a workspace before creating a plan.");
      return;
    }

    if (!body) {
      log("ERROR: describe the change first.");
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === "2" ? { ...task, status: "ready" } :
        task.id === "3" ? { ...task, status: "running" } :
        task,
      ),
    );

    const encoded = b64(body);
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
  'created_by': 'Adjutorix power workbench'
}, indent=2), encoding='utf-8')
print(target)
PY`;

    await runCommand(planCommand, workspace);
    setTasks((current) => current.map((task) => (task.id === "3" ? { ...task, status: "ready" } : task)));
  }, [log, prompt, runCommand, workspace]);

  const powerActions = [
    { label: "Scan", command: "find . -maxdepth 6 -type f | sed 's#^./##' | head -200" },
    { label: "Git", command: "git status --short" },
    { label: "Diff", command: "git diff --stat && git diff | head -240" },
    { label: "Verify", command: "pnpm run verify" },
    { label: "Build", command: "pnpm -r --if-present run build" },
    { label: "Typecheck", command: "pnpm --filter @adjutorix/app run build:ts" },
    { label: "Tests", command: "pnpm --filter @adjutorix/app exec vitest run" },
    { label: "Routes", command: "grep -R \"ipcMain.handle\\|safeHandle\\|exposeInMainWorld\" -n packages/adjutorix-app/src | head -120" },
    { label: "Logs", command: "find .tmp reports/current -type f 2>/dev/null | head -80" },
    { label: "Package", command: "ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh" },
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
                onClick={() => void openFile(file)}
              >
                <strong>{basename(file.path)}</strong>
                <span>{file.path}</span>
              </button>
            ))
          ) : (
            <section className="adjutorix-cursor-empty">
              <h2>Power engine waiting</h2>
              <p>Load the workspace. Adjutorix will scan files, open buffers, run commands, create plans, verify, build, test, diff, and package.</p>
              <button type="button" onClick={() => void scan(pathInput || workspace)}>Scan Workspace</button>
              <button type="button" onClick={() => void openRepository()}>Open Folder</button>
            </section>
          )}
        </div>
      </aside>

      <main className="adjutorix-cursor-main">
        <header className="adjutorix-cursor-command">
          <div>
            <strong>ADJUTORIX</strong>
            <span>million-level governed agent IDE</span>
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
            placeholder="Example: make the scanner flow faster, add validation, then verify before apply..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Generate governed plan
          </button>
        </section>

        <section className="adjutorix-cursor-powers">
          <h3>All features</h3>
          <div>
            {powerActions.map((action) => (
              <button key={action.label} type="button" onClick={() => void runCommand(action.command)}>
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
