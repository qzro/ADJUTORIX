import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/adjutorix-power-workbench.css";

type WorkspaceFile = {
  path: string;
  name: string;
  kind: "source" | "test" | "config" | "doc" | "asset" | "other";
  size: number;
  mtimeMs: number;
};

type UniversalBridge = {
  resolveDefaultWorkspace: () => Promise<{
    envWorkspace: string;
    home: string;
    cwd: string;
    source: string;
  }>;
  scan: (workspace: string) => Promise<{
    ok: boolean;
    source: string;
    workspace: string;
    fileCount: number;
    truncated: boolean;
    files: WorkspaceFile[];
  }>;
  readText: (input: { workspace: string; path: string }) => Promise<{
    ok: boolean;
    source: string;
    workspace: string;
    path: string;
    content: string;
  }>;
  writeText: (input: { workspace: string; path: string; content: string }) => Promise<unknown>;
  gitDiff: (input: { workspace: string; path?: string }) => Promise<{
    ok: boolean;
    source: string;
    workspace: string;
    output: string;
  }>;
  run: (input: { workspace: string; command: string; timeoutMs?: number }) => Promise<{
    ok: boolean;
    source: string;
    workspace: string;
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>;
};

declare global {
  interface Window {
    adjutorixUniversalWorkspace?: UniversalBridge;
  }
}

type Action = {
  id: string;
  title: string;
  command: string;
};

const ACTIONS: Action[] = [
  {
    id: "status",
    title: "Git status",
    command: "pwd; git status --short 2>/dev/null || true; git log --oneline --decorate --max-count=8 2>/dev/null || true",
  },
  {
    id: "detect",
    title: "Detect",
    command:
      "pwd; test -f package.json && node -e \"const p=require('./package.json'); console.log('package:', p.name || '(unnamed)'); console.log('scripts:', JSON.stringify(p.scripts || {}, null, 2))\" || true; test -f pyproject.toml && sed -n '1,140p' pyproject.toml || true; test -f README.md && sed -n '1,90p' README.md || true",
  },
  {
    id: "verify",
    title: "Verify",
    command:
      "test -x scripts/verify.sh && bash scripts/verify.sh || test -x ./verify.sh && bash ./verify.sh || echo 'No verify script detected in this workspace.'",
  },
  {
    id: "test",
    title: "Test",
    command:
      "test -f package.json && pnpm -s test || test -f package.json && npm test || test -f pyproject.toml && python -m pytest || echo 'No standard test command detected in this workspace.'",
  },
  {
    id: "build",
    title: "Build",
    command:
      "test -f package.json && pnpm -s run build || test -f package.json && npm run build || echo 'No standard build command detected in this workspace.'",
  },
  {
    id: "power",
    title: "Power",
    command:
      "test -x scripts/power/verify-adjutorix-power-packages.sh && pnpm power:verify && pnpm power:plane || echo 'No Adjutorix power plane detected in this workspace.'",
  },
];

function bridge(): UniversalBridge {
  const api = window.adjutorixUniversalWorkspace;

  if (!api) {
    throw new Error("adjutorixUniversalWorkspace bridge unavailable");
  }

  return api;
}

function fileWeight(file: WorkspaceFile): number {
  const path = file.path.toLowerCase();

  if (path === "readme.md") return -10;
  if (path === "package.json") return -9;
  if (path.endsWith("/package.json")) return -8;
  if (path.includes("/src/")) return -7;
  if (file.kind === "source") return 0;
  if (file.kind === "test") return 1;
  if (file.kind === "config") return 2;
  if (file.kind === "doc") return 3;
  if (file.kind === "asset") return 4;
  return 5;
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(localStorage.getItem("adjutorix.activeWorkspace") ?? "");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WorkspaceFile["kind"] | "all">("all");
  const [selected, setSelected] = useState<WorkspaceFile | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [output, setOutput] = useState("Connect any project folder. This is not bound to any single workspace.");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState(ACTIONS[0]?.command ?? "pwd");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return files
      .filter((file) => {
        if (kind !== "all" && file.kind !== kind) return false;
        if (!needle) return true;
        return file.path.toLowerCase().includes(needle) || file.name.toLowerCase().includes(needle);
      })
      .sort((a, b) => fileWeight(a) - fileWeight(b) || a.path.localeCompare(b.path));
  }, [files, kind, query]);

  const counts = useMemo(() => {
    return {
      source: files.filter((file) => file.kind === "source").length,
      test: files.filter((file) => file.kind === "test").length,
      config: files.filter((file) => file.kind === "config").length,
      doc: files.filter((file) => file.kind === "doc").length,
    };
  }, [files]);

  function record(text: string): void {
    setOutput(text.slice(-180000));
  }

  async function connect(path = workspace): Promise<void> {
    const trimmed = path.trim();

    if (!trimmed) {
      record("CONNECT BLOCKED\nPaste any folder path.");
      return;
    }

    setBusy(true);

    try {
      const result = await bridge().scan(trimmed);
      localStorage.setItem("adjutorix.activeWorkspace", result.workspace);
      setWorkspace(result.workspace);
      setFiles(result.files);
      setContent("");
      setDirty(false);

      const preferred =
        result.files.find((file) => file.path === "README.md") ??
        result.files.find((file) => file.path === "package.json") ??
        result.files.find((file) => file.kind === "source") ??
        result.files[0] ??
        null;

      setSelected(preferred);

      record(
        [
          "WORKSPACE CONNECTED",
          result.workspace,
          `${result.fileCount} usable files`,
          `source=${result.source}`,
          result.truncated ? "TRUNCATED=true" : "TRUNCATED=false",
        ].join("\n"),
      );

      console.info(
        "ADJUTORIX_FIXED_WORKSPACE_READY",
        JSON.stringify({
          workspace: result.workspace,
          files: result.fileCount,
          source: result.source,
        }),
      );

      if (preferred) {
        await openFile(preferred, result.workspace);
      }
    } catch (error) {
      record(`CONNECT FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(file: WorkspaceFile, activeWorkspace = workspace): Promise<void> {
    setBusy(true);

    try {
      const result = await bridge().readText({ workspace: activeWorkspace, path: file.path });
      setSelected(file);
      setContent(result.content);
      setDirty(false);
      record(`OPENED\n${result.path}\n${result.content.length} characters`);
    } catch (error) {
      setSelected(file);
      setContent("");
      setDirty(false);
      record(`OPEN FAILED\n${file.path}\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveFile(): Promise<void> {
    if (!selected) {
      record("SAVE BLOCKED\nNo file selected.");
      return;
    }

    setBusy(true);

    try {
      const result = await bridge().writeText({ workspace, path: selected.path, content });
      setDirty(false);
      record(`SAVED\n${JSON.stringify(result, null, 2)}`);
      console.info("ADJUTORIX_FIXED_SAVE_OK", JSON.stringify({ path: selected.path }));
    } catch (error) {
      record(`SAVE FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function diffActive(): Promise<void> {
    setBusy(true);

    try {
      const result = await bridge().gitDiff({ workspace, path: selected?.path });
      record(result.output.trim() || "No diff.");
    } catch (error) {
      record(`DIFF FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(nextCommand = command): Promise<void> {
    if (!workspace.trim()) {
      record("RUN BLOCKED\nConnect a folder first.");
      return;
    }

    setBusy(true);
    setCommand(nextCommand);

    try {
      const result = await bridge().run({ workspace, command: nextCommand, timeoutMs: 300000 });
      record(
        [
          `$ ${result.command}`,
          `workspace=${result.workspace}`,
          `exit=${result.exitCode} timedOut=${result.timedOut} ok=${result.ok}`,
          "",
          result.stdout,
          result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
        ].join("\n"),
      );

      console.info(
        "ADJUTORIX_FIXED_COMMAND_DONE",
        JSON.stringify({
          ok: result.ok,
          exitCode: result.exitCode,
          command: result.command,
        }),
      );
    } catch (error) {
      record(`COMMAND FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.adjutorixFixedWorkspace = "true";
    document.body.dataset.adjutorixFixedWorkspace = "true";
    console.info("ADJUTORIX_FIXED_WORKSPACE_MOUNTED");

    void bridge().resolveDefaultWorkspace().then((defaults) => {
      const stored = localStorage.getItem("adjutorix.activeWorkspace") ?? "";
      const chosen = defaults.envWorkspace || stored;

      if (chosen) {
        setWorkspace(chosen);
        void connect(chosen);
      }
    });
  }, []);

  return (
    <main className="adj-shell">
      <aside className="adj-sidebar">
        <header className="adj-brand">
          <div className="adj-logo">A</div>
          <div className="adj-brand-copy">
            <strong>Adjutorix</strong>
            <span>universal workspace runtime</span>
          </div>
        </header>

        <section className="adj-connect">
          <label>Project folder</label>
          <input
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="/path/to/project"
            spellCheck={false}
          />
          <button disabled={busy} onClick={() => void connect()}>
            Connect
          </button>
        </section>

        <section className="adj-stats">
          <div><strong>{files.length}</strong><span>files</span></div>
          <div><strong>{counts.source}</strong><span>source</span></div>
          <div><strong>{counts.test}</strong><span>tests</span></div>
          <div><strong>{counts.config}</strong><span>config</span></div>
        </section>

        <input
          className="adj-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Open file..."
          spellCheck={false}
        />

        <div className="adj-filters">
          {(["all", "source", "test", "config", "doc", "asset", "other"] as const).map((item) => (
            <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>
              {item}
            </button>
          ))}
        </div>

        <section className="adj-files">
          {filtered.slice(0, 800).map((file) => (
            <button
              key={file.path}
              className={selected?.path === file.path ? "adj-file active" : "adj-file"}
              onClick={() => void openFile(file)}
              title={file.path}
            >
              <b>{file.kind}</b>
              <strong>{file.name}</strong>
              <span>{file.path}</span>
            </button>
          ))}
        </section>
      </aside>

      <section className="adj-editor-pane">
        <header className="adj-editor-head">
          <div className="adj-title">
            <strong>{selected?.name ?? "No file selected"}</strong>
            <span title={selected?.path ?? workspace}>{selected?.path ?? (workspace || "no workspace connected")}</span>
          </div>

          <div className="adj-editor-actions">
            <button disabled={busy || !selected || !dirty} onClick={() => void saveFile()}>Save</button>
            <button disabled={busy || !workspace} onClick={() => void diffActive()}>Diff</button>
          </div>
        </header>

        <textarea
          className="adj-editor"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setDirty(true);
          }}
          placeholder="Open a file from the connected folder. Save writes to the active workspace with backup."
          spellCheck={false}
        />
      </section>

      <aside className="adj-output-pane">
        <header className="adj-output-head">
          <div>
            <strong>Run / Output</strong>
            <span>{busy ? "running" : "idle"}</span>
          </div>
        </header>

        <section className="adj-actions">
          {ACTIONS.map((action) => (
            <button key={action.id} disabled={busy || !workspace} onClick={() => void runCommand(action.command)}>
              {action.title}
            </button>
          ))}
        </section>

        <textarea
          className="adj-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          spellCheck={false}
        />

        <button className="adj-run" disabled={busy || !workspace} onClick={() => void runCommand()}>
          Run in active folder
        </button>

        <pre className="adj-output">{output}</pre>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Adjutorix root element not found");
}

createRoot(root).render(<App />);
