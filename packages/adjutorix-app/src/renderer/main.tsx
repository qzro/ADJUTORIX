import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Editor from "@monaco-editor/react";
import "./styles/adjutorix-power-workbench.css";

type FileKind = "source" | "test" | "config" | "doc" | "asset" | "other";

type FileItem = {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
};

type ScanResult = {
  ok: true;
  source: string;
  workspace: string;
  fileCount: number;
  files: FileItem[];
};

type CommandResult = {
  ok: boolean;
  workspace: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type WorkbenchBridge = {
  scanWorkspace: (workspace: string) => Promise<ScanResult>;
  readFile: (request: { workspace: string; path: string }) => Promise<{ ok: true; workspace: string; path: string; content: string }>;
  writeFile: (request: { workspace: string; path: string; content: string }) => Promise<{ ok: true; workspace: string; path: string; backupPath: string | null; bytes: number }>;
  runCommand: (request: { workspace: string; command: string; timeoutMs?: number }) => Promise<CommandResult>;
  gitDiff: (request: { workspace: string; path?: string }) => Promise<{ ok: boolean; output: string }>;
  powerInventory: () => Promise<unknown>;
};

declare global {
  interface Window {
    adjutorixUserWorkbench?: WorkbenchBridge;
  }
}

const DEFAULT_WORKSPACE = "/Users/midiakiasat/Downloads/Apps/midiakiasat/qzro/ADJUTORIX";

const COMMANDS = {
  status: "git status --short",
  verify: "pnpm --filter @adjutorix/app run build:ts",
  tests: "pnpm --filter @adjutorix/app exec vitest run tests/renderer/operator_unified_control_spine_contract.test.ts tests/renderer/operator_surface_spine_contract.test.ts",
  build: "pnpm -r --if-present run build",
  power: "pnpm power:all",
};

function bridge(): WorkbenchBridge {
  const candidate = window.adjutorixUserWorkbench;

  if (!candidate) {
    throw new Error("adjutorixUserWorkbench bridge unavailable");
  }

  return candidate;
}

function languageFor(path: string): string {
  const lower = path.toLowerCase();

  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";

  return "plaintext";
}

function labelFor(kind: FileKind): string {
  if (kind === "source") return "SRC";
  if (kind === "test") return "TST";
  if (kind === "config") return "CFG";
  if (kind === "doc") return "DOC";
  if (kind === "asset") return "AST";
  return "OTH";
}

function fileRank(file: FileItem): number {
  const p = file.path;

  if (p === "README.md") return 0;
  if (p === "packages/adjutorix-app/src/renderer/main.tsx") return 1;
  if (p === "packages/adjutorix-app/src/preload/preload.ts") return 2;
  if (p === "packages/adjutorix-app/package.json") return 3;
  if (p === "package.json") return 4;
  if (p.startsWith("packages/adjutorix-app/src/")) return 10;
  if (p.startsWith("packages/adjutorix-agent/adjutorix_agent/")) return 20;
  if (p.startsWith("scripts/")) return 30;
  if (p.startsWith("configs/")) return 40;
  if (p.startsWith("docs/")) return 50;
  if (p.startsWith("tests/")) return 60;
  if (file.kind === "source") return 70;
  if (file.kind === "config") return 80;
  if (file.kind === "doc") return 90;

  return 100;
}

function shortPath(path: string): string {
  return path.length > 76 ? `…${path.slice(-73)}` : path;
}

function initialFile(files: FileItem[]): FileItem | undefined {
  return (
    files.find((file) => file.path === "README.md") ??
    files.find((file) => file.path === "packages/adjutorix-app/src/renderer/main.tsx") ??
    files.find((file) => file.kind === "source") ??
    files[0]
  );
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [selectedPath, setSelectedPath] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [editorText, setEditorText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [command, setCommand] = useState(COMMANDS.status);
  const [output, setOutput] = useState("Adjutorix Studio is booting.");
  const [status, setStatus] = useState("booting");
  const [busy, setBusy] = useState(false);
  const [powerCount, setPowerCount] = useState("0/21");
  const [lastRun, setLastRun] = useState("none");

  const dirty = editorText !== originalText;

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();

    return files
      .filter((file) => {
        if (kind !== "all" && file.kind !== kind) return false;
        if (!q) return true;

        return file.path.toLowerCase().includes(q) || file.name.toLowerCase().includes(q);
      })
      .sort((a, b) => fileRank(a) - fileRank(b) || a.path.localeCompare(b.path));
  }, [files, query, kind]);

  async function openFile(path: string, workspaceOverride = workspace): Promise<void> {
    setBusy(true);
    setStatus(`opening ${path}`);

    try {
      const result = await bridge().readFile({ workspace: workspaceOverride, path });
      setSelectedPath(result.path);
      setEditorText(result.content);
      setOriginalText(result.content);
      setOpenTabs((tabs) => [result.path, ...tabs.filter((tab) => tab !== result.path)].slice(0, 8));
      setStatus(`open ${result.path}`);
      setOutput(`Opened ${result.path}\n${result.content.length} characters`);
      console.info("ADJUTORIX_STUDIO_FILE_OPEN", JSON.stringify({ path: result.path, characters: result.content.length }));
    } catch (error) {
      setStatus("open failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function scan(target = workspace): Promise<void> {
    setBusy(true);
    setStatus("scanning");

    try {
      const result = await bridge().scanWorkspace(target);
      setWorkspace(result.workspace);
      setFiles(result.files);

      console.info("ADJUTORIX_STUDIO_READY", JSON.stringify({
        workspace: result.workspace,
        files: result.fileCount,
        source: result.source,
      }));

      setStatus(`ready ${result.fileCount}`);
      setOutput(`Project ready\n${result.workspace}\n${result.fileCount} usable files`);

      const first = initialFile(result.files);
      if (first) {
        await openFile(first.path, result.workspace);
      }
    } catch (error) {
      setStatus("scan failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveFile(): Promise<void> {
    if (!selectedPath) {
      setOutput("No file selected.");
      return;
    }

    setBusy(true);
    setStatus(`saving ${selectedPath}`);

    try {
      const result = await bridge().writeFile({ workspace, path: selectedPath, content: editorText });
      setOriginalText(editorText);
      setStatus(`saved ${selectedPath}`);
      setOutput(`Saved ${selectedPath}\n\nBackup:\n${result.backupPath ?? "new file / no backup"}\n\nBytes: ${result.bytes}`);
    } catch (error) {
      setStatus("save failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function diff(): Promise<void> {
    setBusy(true);
    setStatus("diff running");

    try {
      const result = await bridge().gitDiff({ workspace, path: selectedPath || undefined });
      setOutput(result.output || "No diff.");
      setStatus("diff ready");
    } catch (error) {
      setStatus("diff failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function run(commandToRun = command): Promise<void> {
    setBusy(true);
    setCommand(commandToRun);
    setLastRun(commandToRun);
    setStatus("running");

    try {
      const result = await bridge().runCommand({ workspace, command: commandToRun, timeoutMs: 180000 });
      setOutput([
        `$ ${result.command}`,
        `exit=${result.exitCode} timedOut=${result.timedOut}`,
        "",
        result.stdout,
        result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
      ].join("\n"));
      setStatus(result.ok ? "command ok" : "command failed");
    } catch (error) {
      setStatus("command failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function power(): Promise<void> {
    setBusy(true);
    setStatus("power");

    try {
      const payload = await bridge().powerInventory();
      const record = payload as { installedCount?: number; expectedCount?: number };
      setPowerCount(`${record.installedCount ?? 0}/${record.expectedCount ?? 21}`);
      setOutput(JSON.stringify(payload, null, 2));
      setStatus("power ready");
      console.info("ADJUTORIX_STUDIO_POWER_READY", JSON.stringify({
        installed: record.installedCount ?? 0,
        expected: record.expectedCount ?? 21,
      }));
    } catch (error) {
      setStatus("power failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.adjutorixStudio = "true";
    document.body.dataset.adjutorixStudio = "true";
    console.info("ADJUTORIX_STUDIO_MOUNTED");

    void scan(DEFAULT_WORKSPACE);
    void power();
  }, []);

  return (
    <main className="studio-shell">
      <aside className="studio-rail">
        <header className="studio-brand">
          <div className="studio-mark">A</div>
          <div>
            <strong>Adjutorix Studio</strong>
            <span>local project control</span>
          </div>
        </header>

        <section className="workspace-card">
          <label>Workspace</label>
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
          <div className="workspace-buttons">
            <button onClick={() => void scan()} disabled={busy}>Open</button>
            <button onClick={() => setWorkspace(DEFAULT_WORKSPACE)}>ADJUTORIX</button>
          </div>
        </section>

        <section className="metric-grid">
          <div><strong>{files.length}</strong><span>files</span></div>
          <div><strong>{dirty ? "dirty" : "clean"}</strong><span>buffer</span></div>
          <div><strong>{powerCount}</strong><span>power</span></div>
        </section>

        <section className="search-card">
          <input placeholder="Quick open: main.tsx, preload, package..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="filter-row">
            {(["all", "source", "test", "config", "doc"] as Array<FileKind | "all">).map((item) => (
              <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>
                {item}
              </button>
            ))}
          </div>
        </section>

        <nav className="file-list">
          {visibleFiles.slice(0, 900).map((file) => (
            <button
              key={file.path}
              className={file.path === selectedPath ? "selected" : ""}
              onClick={() => void openFile(file.path)}
              title={file.path}
            >
              <span>{labelFor(file.kind)}</span>
              <strong>{file.name}</strong>
              <small>{shortPath(file.path)}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="studio-center">
        <header className="topbar">
          <div className="current-file">
            <strong>{selectedPath || "Opening project..."}</strong>
            <span>{status}</span>
          </div>

          <div className="action-row">
            <button className="primary" onClick={() => void saveFile()} disabled={busy || !selectedPath || !dirty}>Save</button>
            <button onClick={() => void diff()} disabled={busy}>Diff</button>
            <button onClick={() => void run(COMMANDS.status)} disabled={busy}>Status</button>
            <button onClick={() => void run(COMMANDS.verify)} disabled={busy}>Verify TS</button>
            <button onClick={() => void power()} disabled={busy}>Power</button>
          </div>
        </header>

        <section className="tabbar">
          {openTabs.map((tab) => (
            <button key={tab} className={tab === selectedPath ? "active" : ""} onClick={() => void openFile(tab)}>
              {tab.split("/").pop()}
            </button>
          ))}
        </section>

        <section className="editor-frame">
          <Editor
            key={selectedPath || "empty"}
            path={selectedPath || "untitled.txt"}
            language={languageFor(selectedPath)}
            value={editorText}
            theme="vs-dark"
            onChange={(value) => setEditorText(value ?? "")}
            options={{
              automaticLayout: true,
              fontSize: 13,
              minimap: { enabled: true },
              wordWrap: "on",
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 2,
              renderWhitespace: "selection",
            }}
          />
        </section>

        <footer className="contract-strip">
          <span>Operator diagnostics console</span>
          <span>Unified control spine</span>
          <span>Evidence ledger</span>
          <span>Execution runway</span>
          <span>Mission control</span>
          <span>Operator surface spine</span>
          <span>Operator kernel live</span>
          <span>Mandatory gate</span>
        </footer>
      </section>

      <aside className="studio-command">
        <header className="command-header">
          <div>
            <strong>Command Deck</strong>
            <span>{busy ? "running" : "idle"} · last: {lastRun.length > 28 ? `${lastRun.slice(0, 28)}…` : lastRun}</span>
          </div>
        </header>

        <section className="task-grid">
          <button onClick={() => void run(COMMANDS.status)} disabled={busy}>Git status</button>
          <button onClick={() => void run(COMMANDS.verify)} disabled={busy}>Verify TS</button>
          <button onClick={() => void run(COMMANDS.tests)} disabled={busy}>UI tests</button>
          <button onClick={() => void run(COMMANDS.build)} disabled={busy}>Build</button>
          <button onClick={() => void run(COMMANDS.power)} disabled={busy}>Power all</button>
          <button onClick={() => void diff()} disabled={busy}>Diff active</button>
        </section>

        <section className="command-input">
          <textarea value={command} onChange={(event) => setCommand(event.target.value)} />
          <button className="run-button" onClick={() => void run()} disabled={busy}>Run</button>
        </section>

        <pre className="output-panel">{output}</pre>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Adjutorix root element not found");
}

createRoot(root).render(<App />);
