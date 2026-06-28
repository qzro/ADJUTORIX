import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BridgeApi = {
  openRepository?: () => Promise<unknown>;
  scanWorkspace?: (workspace: string) => Promise<unknown>;
  readFile?: (input: unknown) => Promise<unknown>;
  saveDraft?: (input: unknown) => Promise<unknown>;
  createPlan?: (input: unknown) => Promise<unknown>;
  runCommand?: (input: unknown) => Promise<unknown>;
};

type FileEntry = {
  path: string;
  name: string;
  size?: number;
};

type OpenTab = {
  path: string;
  content: string;
  language: string;
  dirty: boolean;
};

type TerminalLine = {
  level: "ok" | "info" | "warn" | "error" | "cmd";
  text: string;
};

declare global {
  interface Window {
    adjutorixPower?: BridgeApi;
  }
}

const FALLBACK_DOC = `# ADJUTORIX

Real governed coding workbench.

Open a repository. Inspect files. Edit buffers. Save drafts.
Create intent plan objects. Run governed commands. Verify before mutation.
Preserve receipts.
`;

const IGNORED_BINARY = /\.(png|jpg|jpeg|gif|webp|ico|icns|pdf|zip|tar|gz|dmg|mp4|mov|ttf|otf|woff|woff2)$/i;

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function languageFor(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".sh")) return "shell";
  return "text";
}

function walkStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }

  if (!value || typeof value !== "object") {
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => walkStrings(item, out));
    return out;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["stdout", "stderr", "output", "text", "body", "message", "value", "data", "result", "payload"]) {
    if (key in record) {
      walkStrings(record[key], out);
    }
  }

  return out;
}

function outputText(value: unknown): string {
  return walkStrings(value).join("\n").trim();
}

function findWorkspacePath(value: unknown): string | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [value];

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
      const found = record[key];
      if (typeof found === "string" && found.startsWith("/")) {
        return found;
      }
    }

    queue.push(...Object.values(record));
  }

  return null;
}

function parseScanResult(result: unknown): FileEntry[] {
  const strings = walkStrings(result);
  const candidates = strings.flatMap((text) => {
    const trimmed = text.trim();
    const matches = trimmed.match(/\{[\s\S]*\}/g);
    return matches ?? [trimmed];
  });

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const files = safeArray<FileEntry>((parsed as { files?: unknown }).files);
      if (files.length > 0) {
        return files
          .filter((entry) => entry && typeof entry.path === "string")
          .map((entry) => ({
            path: entry.path,
            name: typeof entry.name === "string" ? entry.name : entry.path.split("/").pop() ?? entry.path,
            size: typeof entry.size === "number" ? entry.size : undefined,
          }));
      }
    } catch {
      // Continue scanning possible stdout fragments.
    }
  }

  return [];
}

async function runGovernedCommand(api: BridgeApi | undefined, command: string, cwd?: string): Promise<unknown> {
  if (!api?.runCommand) {
    throw new Error("Governed command bridge is not available.");
  }

  return api.runCommand({
    command,
    ...(cwd ? { cwd } : {}),
  });
}

async function scanWorkspace(api: BridgeApi | undefined, workspace: string): Promise<FileEntry[]> {
  if (api?.scanWorkspace) {
    const result = await api.scanWorkspace(workspace);
    const parsed = parseScanResult(result);
    if (parsed.length > 0) return parsed;
  }

  const result = await runGovernedCommand(
    api,
    "python3 - <<'PY'\nimport json, os\nroot=os.getcwd()\nskip={'.git','node_modules','dist','release','.tmp','__pycache__','.DS_Store'}\nfiles=[]\nfor base, dirs, names in os.walk(root):\n    dirs[:] = [d for d in dirs if d not in skip]\n    relbase=os.path.relpath(base, root)\n    depth=0 if relbase=='.' else relbase.count(os.sep)+1\n    if depth > 5:\n        dirs[:] = []\n        continue\n    for name in names:\n        if name in skip:\n            continue\n        full=os.path.join(base,name)\n        try:\n            size=os.path.getsize(full)\n        except OSError:\n            size=0\n        rel=os.path.relpath(full, root)\n        files.append({'path': rel, 'name': name, 'size': size})\n        if len(files) >= 1400:\n            break\n    if len(files) >= 1400:\n        break\nprint(json.dumps({'workspace': root, 'files': files}, separators=(',', ':')))\nPY",
    workspace,
  );

  return parseScanResult(result);
}

async function readWorkspaceFile(api: BridgeApi | undefined, workspace: string, path: string): Promise<string> {
  if (IGNORED_BINARY.test(path)) {
    return `Binary or preview-only file: ${path}`;
  }

  const command = `python3 - ${shellQuote(path)} <<'PY'
import pathlib, sys
rel = sys.argv[1]
root = pathlib.Path.cwd().resolve()
target = (root / rel).resolve()
if root not in target.parents and target != root:
    raise SystemExit("Refusing to read outside workspace")
print(target.read_text(encoding="utf-8", errors="replace"))
PY`;

  const result = await runGovernedCommand(api, command, workspace);
  return outputText(result) || "";
}

function filteredFiles(files: FileEntry[], query: string): FileEntry[] {
  const q = query.trim().toLowerCase();
  const source = safeArray<FileEntry>(files);
  if (!q) return source.slice(0, 500);
  return source.filter((file) => file.path.toLowerCase().includes(q)).slice(0, 500);
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function AdjutorixPowerWorkbench(): JSX.Element {
  const api = window.adjutorixPower;
  const [workspace, setWorkspace] = useState<string>(() => localStorage.getItem("adjutorix.lastWorkspace") ?? "");
  const [manualWorkspace, setManualWorkspace] = useState<string>(() => localStorage.getItem("adjutorix.lastWorkspace") ?? "");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [tabs, setTabs] = useState<OpenTab[]>([
    {
      path: "ADJUTORIX.md",
      content: FALLBACK_DOC,
      language: "markdown",
      dirty: false,
    },
  ]);
  const [activePath, setActivePath] = useState("ADJUTORIX.md");
  const [intent, setIntent] = useState("");
  const [ask, setAsk] = useState("");
  const [command, setCommand] = useState("git status --short");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [terminal, setTerminal] = useState<TerminalLine[]>([
    { level: "ok", text: "ADJUTORIX workbench online." },
    { level: "info", text: "Open a repository, ask for a change, verify, then apply through governed gates." },
  ]);
  const didAutoScan = useRef(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? tabs[0], [activePath, tabs]);
  const visibleFiles = useMemo(() => filteredFiles(files, filter), [files, filter]);

  const pushLine = useCallback((line: TerminalLine) => {
    setTerminal((current) => [...current.slice(-300), line]);
  }, []);

  const loadWorkspace = useCallback(
    async (nextWorkspace: string) => {
      const trimmed = nextWorkspace.trim();
      if (!trimmed) return;

      setBusy(true);
      setWorkspace(trimmed);
      setManualWorkspace(trimmed);
      localStorage.setItem("adjutorix.lastWorkspace", trimmed);
      pushLine({ level: "cmd", text: `open ${trimmed}` });

      try {
        const scanned = await scanWorkspace(api, trimmed);
        setFiles(scanned);
        pushLine({ level: "ok", text: `Workspace indexed: ${scanned.length} files` });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        pushLine({ level: "error", text });
      } finally {
        setBusy(false);
      }
    },
    [api, pushLine],
  );

  useEffect(() => {
    if (didAutoScan.current || !workspace) return;
    didAutoScan.current = true;
    void loadWorkspace(workspace);
  }, [loadWorkspace, workspace]);

  const openRepository = useCallback(async () => {
    setBusy(true);
    pushLine({ level: "cmd", text: "open repository" });

    try {
      const result = api?.openRepository ? await api.openRepository() : null;
      const selected = findWorkspacePath(result);
      if (selected) {
        await loadWorkspace(selected);
      } else {
        pushLine({ level: "warn", text: "Repository dialog returned no path. Paste a workspace path and press Load." });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      pushLine({ level: "error", text });
    } finally {
      setBusy(false);
    }
  }, [api, loadWorkspace, pushLine]);

  const openFile = useCallback(
    async (entry: FileEntry) => {
      if (!workspace) return;
      setBusy(true);
      pushLine({ level: "cmd", text: `open ${entry.path}` });

      try {
        const content = await readWorkspaceFile(api, workspace, entry.path);
        setTabs((current) => {
          const existing = current.find((tab) => tab.path === entry.path);
          if (existing) {
            return current.map((tab) => (tab.path === entry.path ? { ...tab, content, dirty: false } : tab));
          }

          return [
            ...current,
            {
              path: entry.path,
              content,
              language: languageFor(entry.path),
              dirty: false,
            },
          ];
        });
        setActivePath(entry.path);
        pushLine({ level: "ok", text: `Opened ${entry.path}` });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        pushLine({ level: "error", text });
      } finally {
        setBusy(false);
      }
    },
    [api, pushLine, workspace],
  );

  const updateActiveContent = useCallback((content: string) => {
    setTabs((current) =>
      current.map((tab) => (tab.path === activePath ? { ...tab, content, dirty: true } : tab)),
    );
  }, [activePath]);

  const saveDraft = useCallback(async () => {
    if (!workspace || !activeTab) {
      pushLine({ level: "warn", text: "Open a workspace and file before saving a draft." });
      return;
    }

    const encoded = toBase64Utf8(activeTab.content);
    const commandText = `python3 - ${shellQuote(activeTab.path)} ${shellQuote(encoded)} <<'PY'
import base64, pathlib, sys, time
rel = sys.argv[1]
body = base64.b64decode(sys.argv[2]).decode("utf-8", errors="replace")
root = pathlib.Path.cwd()
draft_dir = root / ".adjutorix" / "workbench-drafts"
draft_dir.mkdir(parents=True, exist_ok=True)
safe = rel.replace("/", "__")
target = draft_dir / f"{int(time.time())}__{safe}"
target.write_text(body, encoding="utf-8")
print(str(target))
PY`;

    setBusy(true);
    pushLine({ level: "cmd", text: `save draft ${activeTab.path}` });

    try {
      const result = await runGovernedCommand(api, commandText, workspace);
      pushLine({ level: "ok", text: `Draft saved: ${outputText(result)}` });
      setTabs((current) => current.map((tab) => (tab.path === activeTab.path ? { ...tab, dirty: false } : tab)));
    } catch (error) {
      pushLine({ level: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [activeTab, api, pushLine, workspace]);

  const createPlan = useCallback(async () => {
    if (!workspace) {
      pushLine({ level: "warn", text: "Open a workspace before creating a plan." });
      return;
    }

    const body = intent.trim() || ask.trim() || "No intent provided.";
    const encoded = toBase64Utf8(body);
    const commandText = `python3 - ${shellQuote(encoded)} <<'PY'
import base64, json, pathlib, sys, time
intent = base64.b64decode(sys.argv[1]).decode("utf-8", errors="replace")
root = pathlib.Path.cwd()
objects = root / ".adjutorix" / "objects"
objects.mkdir(parents=True, exist_ok=True)
target = objects / f"intent-plan-{int(time.time())}.json"
target.write_text(json.dumps({
  "schema": "adjutorix.intent_plan.v1",
  "intent": intent,
  "apply": "BLOCKED_UNTIL_VERIFY",
  "created_by": "Adjutorix workbench"
}, indent=2), encoding="utf-8")
print(str(target))
PY`;

    setBusy(true);
    pushLine({ level: "cmd", text: "create intent plan" });

    try {
      const result = await runGovernedCommand(api, commandText, workspace);
      pushLine({ level: "ok", text: `Plan created: ${outputText(result)}` });
      setIntent("");
    } catch (error) {
      pushLine({ level: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [api, ask, intent, pushLine, workspace]);

  const runCommand = useCallback(
    async (nextCommand = command) => {
      const trimmed = nextCommand.trim();
      if (!trimmed) return;

      setBusy(true);
      pushLine({ level: "cmd", text: `$ ${trimmed}` });

      try {
        const result = await runGovernedCommand(api, trimmed, workspace || undefined);
        const text = outputText(result) || "Command completed.";
        pushLine({ level: "info", text });
      } catch (error) {
        pushLine({ level: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    },
    [api, command, pushLine, workspace],
  );

  return (
    <section className="adjutorix-super-workbench" data-busy={busy ? "true" : "false"}>
      {paletteOpen ? (
        <div className="adjutorix-command-palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="adjutorix-command-palette" onClick={(event) => event.stopPropagation()}>
            <p>Command Palette</p>
            <input
              autoFocus
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setPaletteOpen(false);
                  void runCommand(command);
                }
                if (event.key === "Escape") setPaletteOpen(false);
              }}
              placeholder="Run governed command..."
            />
            <div>
              {["git status --short", "pnpm run verify", "pnpm -r --if-present run build", "find . -maxdepth 2 -type f | head -80"].map(
                (item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setCommand(item);
                      setPaletteOpen(false);
                      void runCommand(item);
                    }}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}

      <aside className="adjutorix-activity-rail">
        <button type="button" className="is-active" title="Explorer">▰</button>
        <button type="button" title="Search">⌕</button>
        <button type="button" title="Source Control">⑂</button>
        <button type="button" title="Verify">✓</button>
        <button type="button" title="Run">▶</button>
      </aside>

      <aside className="adjutorix-explorer">
        <header>
          <span>Explorer</span>
          <button type="button" onClick={() => void openRepository()}>
            Open
          </button>
        </header>

        <section className="adjutorix-workspace-card">
          <p>Workspace</p>
          <strong>{workspace || "No workspace"}</strong>
          <em>{busy ? "Working..." : "Bridge connected"}</em>
        </section>

        {!workspace ? (
          <section className="adjutorix-start-card">
            <h2>Start in 3 seconds</h2>
            <p>Open a folder or paste a path. Then ask, edit, verify, and save governed drafts.</p>
            <button type="button" onClick={() => void openRepository()}>
              Open Folder
            </button>
            <div className="adjutorix-path-loader">
              <input
                value={manualWorkspace}
                onChange={(event) => setManualWorkspace(event.target.value)}
                placeholder="/Users/.../project"
              />
              <button type="button" onClick={() => void loadWorkspace(manualWorkspace)}>
                Load
              </button>
            </div>
          </section>
        ) : null}

        <input
          className="adjutorix-file-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search files..."
        />

        <div className="adjutorix-file-list">
          {visibleFiles.length > 0 ? (
            visibleFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={file.path === activePath ? "is-active" : ""}
                onClick={() => void openFile(file)}
              >
                <strong>{file.name}</strong>
                <span>{file.path}</span>
              </button>
            ))
          ) : (
            <p className="adjutorix-empty-list">
              {workspace ? "No files found. Use command palette or refresh workspace." : "Open a repository to load the real file tree."}
            </p>
          )}
        </div>
      </aside>

      <main className="adjutorix-editor-region">
        <header className="adjutorix-top-command-bar">
          <div>
            <strong>ADJUTORIX</strong>
            <span>real governed IDE workbench</span>
          </div>
          <button type="button" onClick={() => setPaletteOpen(true)}>Command Palette</button>
          <button type="button" onClick={() => void saveDraft()}>Save Draft</button>
          <button type="button" onClick={() => void createPlan()}>Create Plan</button>
          <button type="button" onClick={() => void runCommand("git status --short")}>Git Status</button>
          <button type="button" onClick={() => void runCommand("pnpm run verify")}>Verify Build</button>
        </header>

        <nav className="adjutorix-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.path}
              type="button"
              className={tab.path === activePath ? "is-active" : ""}
              onClick={() => setActivePath(tab.path)}
            >
              {tab.path.split("/").pop()}
              {tab.dirty ? " •" : ""}
            </button>
          ))}
        </nav>

        <section className="adjutorix-editor-shell">
          <header>
            <span>{activeTab?.path ?? "No file"}</span>
            <em>{activeTab?.language ?? "text"}</em>
          </header>
          <textarea
            spellCheck={false}
            value={activeTab?.content ?? ""}
            onChange={(event) => updateActiveContent(event.target.value)}
          />
        </section>

        <section className="adjutorix-terminal">
          <header>
            <strong>Terminal</strong>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runCommand();
              }}
              placeholder="real governed command..."
            />
          </header>
          <div>
            {terminal.map((line, index) => (
              <pre key={`${line.level}-${index}`} data-level={line.level}>{line.text}</pre>
            ))}
          </div>
        </section>
      </main>

      <aside className="adjutorix-assistant">
        <nav>
          <button type="button" className="is-active">Assistant</button>
          <button type="button" onClick={() => setPaletteOpen(true)}>Commands</button>
          <button type="button" onClick={() => void runCommand("git status --short")}>Governance</button>
        </nav>

        <section>
          <h2>Operator Assistant</h2>
          <p>Describe the change. Adjutorix creates a plan object before mutation and keeps apply blocked until verification.</p>
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Describe the code change..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Write Intent Plan Object
          </button>
        </section>

        <footer>
          <input
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createPlan();
            }}
            placeholder="Ask Adjutorix..."
          />
          <button type="button" onClick={() => void createPlan()}>Capture</button>
        </footer>
      </aside>

      <footer className="adjutorix-status-bar">
        <span>Adjutorix</span>
        <span>{workspace || "No workspace"}</span>
        <span>Bridge: connected</span>
        <span>Tree: {files.length ? `${files.length} files` : "empty"}</span>
        <span>Apply: blocked</span>
      </footer>
    </section>
  );
}
