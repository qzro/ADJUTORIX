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
    throw new Error("adjutorixUserWorkbench bridge is not available");
  }

  return candidate;
}

function kindLabel(kind: FileKind): string {
  if (kind === "source") return "SRC";
  if (kind === "test") return "TST";
  if (kind === "config") return "CFG";
  if (kind === "doc") return "DOC";
  if (kind === "asset") return "AST";
  return "OTH";
}

function chooseInitialFile(files: FileItem[]): FileItem | undefined {
  const preferred = [
    "README.md",
    "packages/adjutorix-app/src/renderer/main.tsx",
    "packages/adjutorix-app/src/preload/preload.ts",
    "packages/adjutorix-app/package.json",
    "package.json",
  ];

  for (const path of preferred) {
    const found = files.find((file) => file.path === path);
    if (found) return found;
  }

  return files.find((file) => file.kind === "source") ?? files[0];
}

function visiblePath(path: string): string {
  return path.length > 70 ? `…${path.slice(-67)}` : path;
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<FileKind | "all">("all");
  const [selectedPath, setSelectedPath] = useState("");
  const [editorText, setEditorText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [command, setCommand] = useState(COMMANDS.status);
  const [output, setOutput] = useState("Booting Adjutorix user workbench.");
  const [status, setStatus] = useState("booting");
  const [busy, setBusy] = useState(false);
  const [powerCount, setPowerCount] = useState("0/21");

  const dirty = editorText !== originalText;

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();

    return files.filter((file) => {
      if (kindFilter !== "all" && file.kind !== kindFilter) return false;
      if (!q) return true;
      return file.path.toLowerCase().includes(q) || file.name.toLowerCase().includes(q) || file.kind.includes(q);
    });
  }, [files, filter, kindFilter]);

  async function openFile(path: string, currentWorkspace = workspace): Promise<void> {
    setBusy(true);
    setStatus(`opening ${path}`);

    try {
      const result = await bridge().readFile({ workspace: currentWorkspace, path });
      setSelectedPath(result.path);
      setEditorText(result.content);
      setOriginalText(result.content);
      setStatus(`open ${result.path}`);
      setOutput(`OPENED\n${result.path}\n\n${result.content.length} characters`);
      console.info("ADJUTORIX_USER_WORKBENCH_FILE_OPEN", JSON.stringify({ path: result.path, characters: result.content.length }));
    } catch (error) {
      setStatus("open failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function scan(target = workspace): Promise<void> {
    setBusy(true);
    setStatus("scanning workspace");

    try {
      const result = await bridge().scanWorkspace(target);
      setWorkspace(result.workspace);
      setFiles(result.files);

      const initial = chooseInitialFile(result.files);
      setStatus(`ready ${result.fileCount} files`);
      setOutput(`WORKSPACE READY\n${result.workspace}\n${result.fileCount} usable files via ${result.source}`);

      console.info("ADJUTORIX_USER_WORKBENCH_READY", JSON.stringify({
        workspace: result.workspace,
        files: result.fileCount,
        source: result.source,
      }));

      if (initial) {
        await openFile(initial.path, result.workspace);
      }
    } catch (error) {
      setStatus("scan failed");
      setOutput(String(error));
      console.error("ADJUTORIX_USER_WORKBENCH_SCAN_FAILED", error);
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
      setOutput(`SAVED\n${JSON.stringify(result, null, 2)}`);
    } catch (error) {
      setStatus("save failed");
      setOutput(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function showDiff(): Promise<void> {
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
    setStatus("command running");
    setCommand(commandToRun);

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
      console.info("ADJUTORIX_USER_WORKBENCH_POWER_READY", JSON.stringify({
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
            <span>usable local workbench</span>
          </div>
        </header>

        <section className="user-workspace">
          <label>Workspace</label>
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
          <button onClick={() => void scan()} disabled={busy}>Load workspace</button>
          <button onClick={() => setWorkspace(DEFAULT_WORKSPACE)}>Use ADJUTORIX</button>
        </section>

        <section className="user-stats">
          <div><strong>{files.length}</strong><span>usable files</span></div>
          <div><strong>{dirty ? "dirty" : "clean"}</strong><span>buffer</span></div>
          <div><strong>{powerCount}</strong><span>power</span></div>
        </section>

        <section className="user-filters">
          <input className="user-filter" placeholder="Search files..." value={filter} onChange={(event) => setFilter(event.target.value)} />
          <div className="kind-row">
            {(["all", "source", "test", "config", "doc"] as Array<FileKind | "all">).map((kind) => (
              <button key={kind} className={kindFilter === kind ? "selected" : ""} onClick={() => setKindFilter(kind)}>
                {kind}
              </button>
            ))}
          </div>
        </section>

        <nav className="user-files">
          {filteredFiles.slice(0, 1000).map((file) => (
            <button
              key={file.path}
              className={file.path === selectedPath ? "selected" : ""}
              onClick={() => void openFile(file.path)}
              title={file.path}
            >
              <span>{kindLabel(file.kind)}</span>
              <strong>{file.name}</strong>
              <small>{visiblePath(file.path)}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="user-main">
        <header className="user-toolbar">
          <div className="file-title">
            <strong>{selectedPath || "Opening workspace..."}</strong>
            <span>{status}</span>
          </div>

          <div className="user-actions">
            <button onClick={() => void saveFile()} disabled={busy || !selectedPath || !dirty}>Save</button>
            <button onClick={() => void showDiff()} disabled={busy}>Diff</button>
            <button onClick={() => void run(COMMANDS.status)} disabled={busy}>Status</button>
            <button onClick={() => void run(COMMANDS.verify)} disabled={busy}>Verify TS</button>
            <button onClick={() => void showPower()} disabled={busy}>Power</button>
          </div>
        </header>

        <textarea
          className="user-editor"
          value={editorText}
          onChange={(event) => setEditorText(event.target.value)}
          spellCheck={false}
          placeholder="Adjutorix opens README.md automatically. Select files, edit, save, diff, verify."
        />
      </section>

      <aside className="user-output">
        <header>
          <strong>Run / Output</strong>
          <span>{busy ? "working" : "idle"}</span>
        </header>

        <section className="command-presets">
          <button onClick={() => void run(COMMANDS.status)} disabled={busy}>Git status</button>
          <button onClick={() => void run(COMMANDS.verify)} disabled={busy}>Verify TS</button>
          <button onClick={() => void run(COMMANDS.tests)} disabled={busy}>UI tests</button>
          <button onClick={() => void run(COMMANDS.power)} disabled={busy}>Power verify</button>
        </section>

        <div className="user-command">
          <textarea value={command} onChange={(event) => setCommand(event.target.value)} />
          <button onClick={() => void run()} disabled={busy}>Run</button>
        </div>

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
