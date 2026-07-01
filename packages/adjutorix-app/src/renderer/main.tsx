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
    title: "Status",
    command: "pwd; git status --short 2>/dev/null || true; git log --oneline --decorate --max-count=8 2>/dev/null || true",
  },
  {
    id: "detect",
    title: "Detect stack",
    command:
      "pwd; test -f package.json && node -e \"const p=require('./package.json'); console.log('package:', p.name || '(unnamed)'); console.log('scripts:', JSON.stringify(p.scripts || {}, null, 2))\" || true; test -f pyproject.toml && sed -n '1,120p' pyproject.toml || true; test -f README.md && sed -n '1,80p' README.md || true",
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
    id: "verify",
    title: "Verify",
    command:
      "test -x scripts/verify.sh && bash scripts/verify.sh || test -x ./verify.sh && bash ./verify.sh || echo 'No verify script detected in this workspace.'",
  },
  {
    id: "agent",
    title: "Agent",
    command:
      "test -x scripts/agent/status.sh && bash scripts/agent/status.sh || echo 'No Adjutorix agent surface detected in this workspace.'",
  },
  {
    id: "power",
    title: "Power",
    command:
      "test -x scripts/power/verify-adjutorix-power-packages.sh && pnpm power:verify && pnpm power:plane || echo 'No Adjutorix power plane detected in this workspace.'",
  },
  {
    id: "clean",
    title: "Clean generated",
    command:
      "rm -rf .tmp dist release build .pytest_cache **/__pycache__ 2>/dev/null || true; git status --short 2>/dev/null || true",
  },
];

function bridge(): UniversalBridge {
  const value = window.adjutorixUniversalWorkspace;

  if (!value) {
    throw new Error("adjutorixUniversalWorkspace bridge unavailable");
  }

  return value;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(localStorage.getItem("adjutorix.activeWorkspace") ?? "");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WorkspaceFile["kind"] | "all">("all");
  const [selected, setSelected] = useState<WorkspaceFile | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [output, setOutput] = useState("Paste or provide any folder path. Adjutorix is no longer bound to one folder.");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState(ACTIONS[0]?.command ?? "pwd");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return files.filter((file) => {
      if (kind !== "all" && file.kind !== kind) return false;
      if (!needle) return true;
      return file.path.toLowerCase().includes(needle) || file.name.toLowerCase().includes(needle);
    });
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
    setOutput(text.slice(-160000));
  }

  async function connect(path = workspace): Promise<void> {
    const trimmed = path.trim();

    if (!trimmed) {
      record("Workspace required. Paste any folder path. Nothing is hardcoded.");
      return;
    }

    setBusy(true);

    try {
      const result = await bridge().scan(trimmed);
      localStorage.setItem("adjutorix.activeWorkspace", result.workspace);
      setWorkspace(result.workspace);
      setFiles(result.files);
      setSelected(result.files[0] ?? null);
      setContent("");
      setDirty(false);
      record(
        [
          "WORKSPACE CONNECTED",
          result.workspace,
          `${result.fileCount} files`,
          `source=${result.source}`,
          result.truncated ? "TRUNCATED=true" : "TRUNCATED=false",
        ].join("\n"),
      );

      console.info(
        "ADJUTORIX_UNIVERSAL_WORKSPACE_READY",
        JSON.stringify({
          workspace: result.workspace,
          files: result.fileCount,
          source: result.source,
        }),
      );
    } catch (error) {
      record(`CONNECT FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(file: WorkspaceFile): Promise<void> {
    setBusy(true);

    try {
      const result = await bridge().readText({ workspace, path: file.path });
      setSelected(file);
      setContent(result.content);
      setDirty(false);
      record(`OPENED\n${result.path}\n${result.content.length} characters`);
    } catch (error) {
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
      console.info("ADJUTORIX_UNIVERSAL_SAVE_OK", JSON.stringify({ path: selected.path }));
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
        "ADJUTORIX_UNIVERSAL_COMMAND_DONE",
        JSON.stringify({
          command: result.command,
          ok: result.ok,
          exitCode: result.exitCode,
        }),
      );
    } catch (error) {
      record(`COMMAND FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.adjutorixUniversalWorkspace = "true";
    document.body.dataset.adjutorixUniversalWorkspace = "true";
    console.info("ADJUTORIX_UNIVERSAL_WORKSPACE_MOUNTED");

    void bridge().resolveDefaultWorkspace().then((defaults) => {
      const stored = localStorage.getItem("adjutorix.activeWorkspace") ?? "";
      const chosen = stored || defaults.envWorkspace || "";

      if (chosen) {
        setWorkspace(chosen);
        void connect(chosen);
      }
    });
  }, []);

  return (
    <main className="workspace-shell">
      <aside className="workspace-side">
        <header className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Adjutorix</strong>
            <span>universal workspace host</span>
          </div>
        </header>

        <section className="workspace-connect">
          <label>Any folder path</label>
          <input
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="/path/to/any/project"
          />
          <button disabled={busy} onClick={() => void connect()}>
            Connect folder
          </button>
        </section>

        <section className="stats">
          <div><strong>{files.length}</strong><span>files</span></div>
          <div><strong>{counts.source}</strong><span>source</span></div>
          <div><strong>{counts.test}</strong><span>tests</span></div>
          <div><strong>{counts.config}</strong><span>config</span></div>
        </section>

        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this folder..."
        />

        <div className="filters">
          {(["all", "source", "test", "config", "doc", "asset", "other"] as const).map((item) => (
            <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>
              {item}
            </button>
          ))}
        </div>

        <section className="file-list">
          {filtered.slice(0, 900).map((file) => (
            <button
              key={file.path}
              className={selected?.path === file.path ? "file active" : "file"}
              onClick={() => void openFile(file)}
            >
              <b>{file.kind}</b>
              <strong>{file.name}</strong>
              <span>{file.path}</span>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace-main">
        <header className="topbar">
          <div>
            <strong>{selected?.path ?? "No file selected"}</strong>
            <span>{dirty ? "modified buffer" : workspace || "no workspace connected"}</span>
          </div>

          <div className="top-actions">
            <button disabled={busy || !selected || !dirty} onClick={() => void saveFile()}>Save</button>
            <button disabled={busy} onClick={() => void diffActive()}>Diff</button>
            {ACTIONS.map((action) => (
              <button key={action.id} disabled={busy || !workspace} onClick={() => void runCommand(action.command)}>
                {action.title}
              </button>
            ))}
          </div>
        </header>

        <textarea
          className="editor"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setDirty(true);
          }}
          placeholder="Open a file from the connected folder. This surface is not tied to any single project."
        />
      </section>

      <aside className="output">
        <header>
          <strong>Workspace Output</strong>
          <span>{busy ? "running" : "idle"}</span>
        </header>

        <textarea
          className="command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />

        <button className="run" disabled={busy || !workspace} onClick={() => void runCommand()}>
          Run in active folder
        </button>

        <pre>{output}</pre>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Adjutorix root element not found");
}

createRoot(root).render(<App />);
