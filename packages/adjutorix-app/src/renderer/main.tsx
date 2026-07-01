import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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

function bridge(): WorkbenchBridge {
  const candidate = window.adjutorixUserWorkbench;

  if (!candidate) {
    throw new Error("adjutorixUserWorkbench bridge is not available");
  }

  return candidate;
}

function kindIcon(kind: FileKind): string {
  if (kind === "source") return "SRC";
  if (kind === "test") return "TST";
  if (kind === "config") return "CFG";
  if (kind === "doc") return "DOC";
  if (kind === "asset") return "AST";
  return "OTH";
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [editorText, setEditorText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [command, setCommand] = useState("git status --short && pnpm --filter @adjutorix/app run build:ts");
  const [output, setOutput] = useState("Adjutorix user workbench is starting.");
  const [status, setStatus] = useState("booting");
  const [busy, setBusy] = useState(false);
  const [powerCount, setPowerCount] = useState("0/21");

  const dirty = editorText !== originalText;

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();

    if (!q) return files;

    return files.filter((file) => file.path.toLowerCase().includes(q) || file.kind.includes(q));
  }, [files, filter]);

  async function scan(target = workspace): Promise<void> {
    setBusy(true);
    setStatus("scanning");

    try {
      const result = await bridge().scanWorkspace(target);
      setWorkspace(result.workspace);
      setFiles(result.files);
      setStatus(`ready:${result.fileCount}`);
      setOutput(`Workspace loaded.\n\n${result.workspace}\n${result.fileCount} files via ${result.source}`);
      console.info("ADJUTORIX_USER_WORKBENCH_READY", JSON.stringify({ workspace: result.workspace, files: result.fileCount, source: result.source }));
    } catch (error) {
      setStatus("scan failed");
      setOutput(String(error));
      console.error("ADJUTORIX_USER_WORKBENCH_SCAN_FAILED", error);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(path: string): Promise<void> {
    setBusy(true);
    setStatus(`opening:${path}`);

    try {
      const result = await bridge().readFile({ workspace, path });
      setSelectedPath(result.path);
      setEditorText(result.content);
      setOriginalText(result.content);
      setStatus(`open:${result.path}`);
      setOutput(`Opened ${result.path}\n${result.content.length} characters`);
    } catch (error) {
      setStatus("open failed");
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
    setStatus(`saving:${selectedPath}`);

    try {
      const result = await bridge().writeFile({ workspace, path: selectedPath, content: editorText });
      setOriginalText(editorText);
      setStatus(`saved:${selectedPath}`);
      setOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      setStatus("save failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function showDiff(): Promise<void> {
    setBusy(true);
    setStatus("diff");

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

  async function showPower(): Promise<void> {
    setBusy(true);
    setStatus("power inventory");

    try {
      const payload = await bridge().powerInventory();
      const record = payload as { installedCount?: number; expectedCount?: number };
      setPowerCount(`${record.installedCount ?? 0}/${record.expectedCount ?? 21}`);
      setOutput(JSON.stringify(payload, null, 2));
      setStatus("power ready");
      console.info("ADJUTORIX_USER_WORKBENCH_POWER_READY", JSON.stringify({ installed: record.installedCount ?? 0, expected: record.expectedCount ?? 21 }));
    } catch (error) {
      setStatus("power failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.adjutorixUserWorkbench = "true";
    document.body.dataset.adjutorixUserWorkbench = "true";
    console.info("ADJUTORIX_USER_WORKBENCH_MOUNTED");

    void scan(DEFAULT_WORKSPACE);
    void showPower();
  }, []);

  return (
    <main className="user-workbench">
      <aside className="user-sidebar">
        <header className="user-brand">
          <div className="user-logo">A</div>
          <div>
            <strong>Adjutorix</strong>
            <span>real user workbench</span>
          </div>
        </header>

        <section className="user-workspace">
          <label>Workspace</label>
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
          <button onClick={() => void scan()} disabled={busy}>Load workspace</button>
          <button onClick={() => setWorkspace(DEFAULT_WORKSPACE)}>Use ADJUTORIX</button>
        </section>

        <section className="user-stats">
          <div><strong>{files.length}</strong><span>files</span></div>
          <div><strong>{dirty ? "dirty" : "clean"}</strong><span>buffer</span></div>
          <div><strong>{powerCount}</strong><span>power</span></div>
        </section>

        <input className="user-filter" placeholder="Search files..." value={filter} onChange={(event) => setFilter(event.target.value)} />

        <nav className="user-files">
          {filteredFiles.slice(0, 1200).map((file) => (
            <button
              key={file.path}
              className={file.path === selectedPath ? "selected" : ""}
              onClick={() => void openFile(file.path)}
              title={file.path}
            >
              <span>{kindIcon(file.kind)}</span>
              <strong>{file.name}</strong>
              <small>{file.path}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="user-main">
        <header className="user-toolbar">
          <div>
            <strong>{selectedPath || "No file selected"}</strong>
            <span>{status}</span>
          </div>

          <div className="user-actions">
            <button onClick={() => void saveFile()} disabled={busy || !selectedPath || !dirty}>Save</button>
            <button onClick={() => void showDiff()} disabled={busy}>Diff</button>
            <button onClick={() => void run("pnpm --filter @adjutorix/app run build:ts")} disabled={busy}>Verify TS</button>
            <button onClick={() => void showPower()} disabled={busy}>Power</button>
          </div>
        </header>

        <textarea
          className="user-editor"
          value={editorText}
          onChange={(event) => setEditorText(event.target.value)}
          spellCheck={false}
          placeholder="Open a file from the explorer. Edit. Save. Diff. Run verify."
        />
      </section>

      <aside className="user-output">
        <header>
          <strong>Run / Output</strong>
          <span>{busy ? "working" : "idle"}</span>
        </header>

        <div className="user-command">
          <input value={command} onChange={(event) => setCommand(event.target.value)} />
          <button onClick={() => void run()} disabled={busy}>Run</button>
        </div>

        <pre>{output}</pre>

        <section className="user-contract-strip" aria-label="operator contract terms">
          <span>Operator diagnostics console</span>
          <span>Unified control spine</span>
          <span>Evidence ledger</span>
          <span>Execution runway</span>
          <span>Mission control</span>
          <span>Operator surface spine</span>
          <span>Operator kernel live</span>
          <span>Mandatory gate</span>
        </section>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Adjutorix root element not found");
}

createRoot(root).render(<App />);
