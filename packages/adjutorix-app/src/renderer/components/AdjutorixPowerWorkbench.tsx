import React, { useCallback, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";

type TreeEntry = {
  name: string;
  absolutePath: string;
  relativePath: string;
  kind: "file" | "directory";
  depth: number;
  sizeBytes?: number;
};

type OpenRepositoryResult = {
  workspace: string;
  tree: TreeEntry[];
} | null;

type ReadFileResult = {
  relativePath: string;
  body: string;
  language: string;
};

type CommandResult = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type WorkFile = {
  id: string;
  name: string;
  relativePath: string;
  language: string;
  body: string;
  dirty: boolean;
};

type TerminalLine = {
  kind: "cmd" | "ok" | "warn" | "error" | "info";
  text: string;
};

type AdjutorixPowerApi = {
  openRepository: () => Promise<OpenRepositoryResult>;
  scanWorkspace: (workspace: string) => Promise<{ workspace: string; tree: TreeEntry[] }>;
  readFile: (request: { workspace: string; relativePath: string }) => Promise<ReadFileResult>;
  saveDraft: (request: { workspace: string; relativePath: string; body: string }) => Promise<{ draftPath: string }>;
  createPlan: (request: { workspace: string; intent: string }) => Promise<{ planPath: string; body: string }>;
  runCommand: (request: { workspace: string; command: string }) => Promise<CommandResult>;
};

type Rail = "explorer" | "search" | "git" | "verify" | "ledger" | "run";
type RightPanel = "assistant" | "governance" | "timeline";
type BottomPanel = "terminal" | "problems" | "output";

const bootFile: WorkFile = {
  id: "boot-readme",
  name: "ADJUTORIX.md",
  relativePath: "ADJUTORIX.md",
  language: "markdown",
  dirty: false,
  body: [
    "# ADJUTORIX",
    "",
    "Real governed coding workbench.",
    "",
    "Open a repository. Inspect files. Edit buffers. Save drafts. Create intent plan objects. Run governed commands. Verify before mutation. Preserve receipts.",
  ].join("\n"),
};

function getApi(): AdjutorixPowerApi | null {
  const windowWithApi = window as unknown as { adjutorixPower?: AdjutorixPowerApi };
  return windowWithApi.adjutorixPower ?? null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function languageForPath(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".sh")) return "shell";
  return "plaintext";
}

function formatCommandResult(result: CommandResult): string {
  const pieces = [
    `$ ${result.command}`,
    `exit=${result.exitCode ?? "null"}`,
  ];

  if (result.stdout.trim()) pieces.push(result.stdout.trimEnd());
  if (result.stderr.trim()) pieces.push(result.stderr.trimEnd());

  return pieces.join("\n");
}

export function AdjutorixPowerWorkbench(): JSX.Element {
  const [rail, setRail] = useState<Rail>("explorer");
  const [rightPanel, setRightPanel] = useState<RightPanel>("assistant");
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>("terminal");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [files, setFiles] = useState<WorkFile[]>([bootFile]);
  const [activeFileId, setActiveFileId] = useState<string>(bootFile.id);
  const [terminalInput, setTerminalInput] = useState<string>("");
  const [intent, setIntent] = useState<string>("");
  const [assistantInput, setAssistantInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [terminal, setTerminal] = useState<TerminalLine[]>([
    { kind: "ok", text: "REAL_WORKBENCH_SPINE online." },
    { kind: "info", text: "Main IPC + preload bridge + renderer are connected." },
  ]);

  const api = getApi();

  const activeFile = useMemo<WorkFile>(() => {
    return files.find((file) => file.id === activeFileId) ?? files[0] ?? bootFile;
  }, [activeFileId, files]);

  const filteredTree = useMemo<TreeEntry[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tree;
    return tree.filter((entry) => entry.relativePath.toLowerCase().includes(q));
  }, [search, tree]);

  const appendTerminal = useCallback((kind: TerminalLine["kind"], text: string): void => {
    setTerminal((current) => [...current.slice(-300), { kind, text }]);
  }, []);

  const openRepository = useCallback(async (): Promise<void> => {
    if (!api) {
      appendTerminal("error", "adjutorixPower preload bridge is not available.");
      return;
    }

    appendTerminal("cmd", "open repository");

    const result = await api.openRepository();

    if (!result) {
      appendTerminal("warn", "Repository selection cancelled.");
      return;
    }

    setWorkspace(result.workspace);
    setTree(result.tree);
    appendTerminal("ok", `Workspace opened: ${result.workspace}`);
    appendTerminal("ok", `Indexed entries: ${result.tree.length}`);
  }, [api, appendTerminal]);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (!api || !workspace) return;

    appendTerminal("cmd", "refresh workspace tree");
    const result = await api.scanWorkspace(workspace);
    setTree(result.tree);
    appendTerminal("ok", `Workspace refreshed: ${result.tree.length} entries`);
  }, [api, appendTerminal, workspace]);

  const openFile = useCallback(async (entry: TreeEntry): Promise<void> => {
    if (!api || !workspace) return;

    if (entry.kind === "directory") {
      appendTerminal("info", `Directory selected: ${entry.relativePath}`);
      return;
    }

    appendTerminal("cmd", `open ${entry.relativePath}`);

    try {
      const result = await api.readFile({ workspace, relativePath: entry.relativePath });
      const id = result.relativePath;

      setFiles((current) => {
        if (current.some((file) => file.id === id)) return current;
        return [
          ...current,
          {
            id,
            name: basename(result.relativePath),
            relativePath: result.relativePath,
            language: result.language,
            body: result.body,
            dirty: false,
          },
        ];
      });

      setActiveFileId(id);
      appendTerminal("ok", `Opened file: ${result.relativePath}`);
    } catch (error) {
      appendTerminal("error", error instanceof Error ? error.message : String(error));
    }
  }, [api, appendTerminal, workspace]);

  const updateActiveBody = useCallback((body: string): void => {
    setFiles((current) =>
      current.map((file) =>
        file.id === activeFile.id
          ? { ...file, body, dirty: true }
          : file,
      ),
    );
  }, [activeFile.id]);

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!api || !workspace) {
      appendTerminal("warn", "Open a workspace before saving a draft.");
      return;
    }

    const result = await api.saveDraft({
      workspace,
      relativePath: activeFile.relativePath,
      body: activeFile.body,
    });

    appendTerminal("ok", `Draft saved: ${result.draftPath}`);
  }, [api, appendTerminal, activeFile, workspace]);

  const createPlan = useCallback(async (): Promise<void> => {
    if (!api || !workspace) {
      appendTerminal("warn", "Open a workspace before creating an intent plan.");
      return;
    }

    const result = await api.createPlan({
      workspace,
      intent: intent.trim() || "No intent text provided.",
    });

    const relative = result.planPath.replace(workspace, "").replace(/^[/\\]/, "");

    setFiles((current) => [
      ...current,
      {
        id: relative,
        name: basename(relative),
        relativePath: relative,
        language: "json",
        body: result.body,
        dirty: false,
      },
    ]);

    setActiveFileId(relative);
    appendTerminal("ok", `Intent plan written: ${result.planPath}`);
    await refreshWorkspace();
  }, [api, appendTerminal, intent, refreshWorkspace, workspace]);

  const runCommand = useCallback(async (command: string): Promise<void> => {
    if (!api || !workspace) {
      appendTerminal("warn", "Open a workspace before running commands.");
      return;
    }

    const trimmed = command.trim();
    if (!trimmed) return;

    setTerminalInput("");
    appendTerminal("cmd", `$ ${trimmed}`);

    try {
      const result = await api.runCommand({ workspace, command: trimmed });
      appendTerminal(result.exitCode === 0 ? "ok" : "warn", formatCommandResult(result));
    } catch (error) {
      appendTerminal("error", error instanceof Error ? error.message : String(error));
    }
  }, [api, appendTerminal, workspace]);

  const quickVerify = useCallback(async (): Promise<void> => {
    await runCommand("pnpm -r --if-present run build");
  }, [runCommand]);

  const quickGitStatus = useCallback(async (): Promise<void> => {
    await runCommand("git status --short && git diff --stat");
  }, [runCommand]);

  const quickAgentStatus = useCallback(async (): Promise<void> => {
    await runCommand("bash scripts/agent/status.sh || true");
  }, [runCommand]);

  const askAssistant = useCallback((): void => {
    const message = assistantInput.trim();
    if (!message) return;

    setAssistantInput("");
    setIntent(message);
    appendTerminal("cmd", `assistant intent captured: ${message}`);
    appendTerminal("info", "Intent is staged in the workbench. Create an intent plan to write the governed object.");
  }, [appendTerminal, assistantInput]);

  const status = {
    workspace: workspace ? "OPEN" : "MISSING",
    tree: tree.length > 0 ? "INDEXED" : "EMPTY",
    file: activeFile.relativePath,
    draft: activeFile.dirty ? "DIRTY" : "CLEAN",
    bridge: api ? "CONNECTED" : "MISSING",
    apply: "BLOCKED_UNTIL_VERIFIED",
  };

  return (
    <div className="real-adjx">
      <aside className="real-adjx-rail">
        {([
          ["explorer", "▱"],
          ["search", "⌕"],
          ["git", "⑂"],
          ["verify", "✓"],
          ["ledger", "▣"],
          ["run", "▶"],
        ] as Array<[Rail, string]>).map(([key, icon]) => (
          <button key={key} className={rail === key ? "active" : ""} onClick={() => setRail(key)}>{icon}</button>
        ))}
      </aside>

      <aside className="real-adjx-sidebar">
        <header>
          <strong>{rail.toUpperCase()}</strong>
          <button onClick={() => void openRepository()}>Open</button>
        </header>

        <section className="workspace-card">
          <span>WORKSPACE</span>
          <strong>{workspace ?? "NO WORKSPACE"}</strong>
          <em>{api ? "BRIDGE CONNECTED" : "BRIDGE MISSING"}</em>
        </section>

        <input
          className="sidebar-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search files..."
        />

        <div className="tree">
          {filteredTree.length === 0 && (
            <div className="empty-tree">Open a repository to load the real file tree.</div>
          )}
          {filteredTree.map((entry) => (
            <button
              key={entry.relativePath}
              className={entry.kind}
              style={{ paddingLeft: 12 + entry.depth * 14 }}
              onClick={() => void openFile(entry)}
              title={entry.absolutePath}
            >
              <span>{entry.kind === "directory" ? "▸" : "•"}</span>
              <strong>{entry.name}</strong>
              <small>{entry.relativePath}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="real-adjx-main">
        <header className="topbar">
          <div>
            <strong>ADJUTORIX</strong>
            <span>real governed IDE workbench</span>
          </div>
          <nav>
            <button onClick={() => setPaletteOpen(true)}>Command Palette</button>
            <button onClick={() => void saveDraft()}>Save Draft</button>
            <button onClick={() => void createPlan()}>Create Plan</button>
            <button onClick={() => void quickGitStatus()}>Git Status</button>
            <button onClick={() => void quickVerify()}>Verify Build</button>
          </nav>
        </header>

        <div className="tabs">
          {files.map((file) => (
            <button key={file.id} className={file.id === activeFile.id ? "active" : ""} onClick={() => setActiveFileId(file.id)}>
              {file.dirty ? "● " : ""}{file.name}
            </button>
          ))}
        </div>

        <section className="editor-shell">
          <div className="editor-meta">
            <span>{activeFile.relativePath}</span>
            <span>{activeFile.language}</span>
          </div>
          <Editor
            height="100%"
            language={activeFile.language || languageForPath(activeFile.relativePath)}
            value={activeFile.body}
            theme="vs-dark"
            options={{
              fontSize: 13,
              fontLigatures: true,
              minimap: { enabled: true },
              smoothScrolling: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "on",
              padding: { top: 16, bottom: 16 },
            }}
            onChange={(value) => updateActiveBody(value ?? "")}
          />
        </section>

        <section className="bottom-panel">
          <div className="panel-tabs">
            {(["terminal", "problems", "output"] as BottomPanel[]).map((panel) => (
              <button key={panel} className={bottomPanel === panel ? "active" : ""} onClick={() => setBottomPanel(panel)}>{panel}</button>
            ))}
          </div>

          {bottomPanel === "terminal" && (
            <div className="terminal">
              <div className="terminal-log">
                {terminal.map((line, index) => (
                  <pre key={`${index}-${line.text}`} className={line.kind}>{line.text}</pre>
                ))}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void runCommand(terminalInput); }}>
                <span>$</span>
                <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder="real governed command..." />
              </form>
            </div>
          )}

          {bottomPanel === "problems" && (
            <div className="problems">
              <div className={workspace ? "ok" : "warn"}>Workspace: {status.workspace}</div>
              <div className={api ? "ok" : "error"}>Preload bridge: {status.bridge}</div>
              <div className="warn">Apply is blocked until verification receipt exists.</div>
            </div>
          )}

          {bottomPanel === "output" && (
            <div className="output">
              <pre>{JSON.stringify(status, null, 2)}</pre>
            </div>
          )}
        </section>
      </main>

      <aside className="real-adjx-right">
        <div className="panel-tabs">
          {(["assistant", "governance", "timeline"] as RightPanel[]).map((panel) => (
            <button key={panel} className={rightPanel === panel ? "active" : ""} onClick={() => setRightPanel(panel)}>{panel}</button>
          ))}
        </div>

        {rightPanel === "assistant" && (
          <section className="assistant">
            <h2>Operator Assistant</h2>
            <p>Capture intent, create plan objects, verify before mutation, and preserve receipts.</p>
            <textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="Describe the code change..." />
            <button onClick={() => void createPlan()}>Write Intent Plan Object</button>
            <div className="chatline">
              <input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") askAssistant();
              }} placeholder="Ask Adjutorix..." />
              <button onClick={askAssistant}>Capture</button>
            </div>
          </section>
        )}

        {rightPanel === "governance" && (
          <section className="governance">
            <h2>Governance Gates</h2>
            {Object.entries(status).map(([key, value]) => (
              <div key={key} className="gate">
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
            <button onClick={() => void quickAgentStatus()}>Agent Status</button>
            <button onClick={() => void quickVerify()}>Run Build Verify</button>
          </section>
        )}

        {rightPanel === "timeline" && (
          <section className="timeline">
            <h2>Evidence Timeline</h2>
            {terminal.slice(-16).map((line, index) => (
              <div key={`${index}-${line.text}`} className={`event ${line.kind}`}>{line.text}</div>
            ))}
          </section>
        )}
      </aside>

      <footer className="statusbar">
        <span>Adjutorix</span>
        <span>{workspace ?? "NO WORKSPACE"}</span>
        <span>Bridge: {status.bridge}</span>
        <span>Tree: {status.tree}</span>
        <span>Apply: BLOCKED</span>
      </footer>

      {paletteOpen && (
        <div className="palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <input autoFocus placeholder="Type a command..." onKeyDown={(event) => {
              if (event.key === "Escape") setPaletteOpen(false);
              if (event.key === "Enter") {
                const value = (event.target as HTMLInputElement).value;
                void runCommand(value);
                setPaletteOpen(false);
              }
            }} />
            <button onClick={() => { void openRepository(); setPaletteOpen(false); }}>Open Repository</button>
            <button onClick={() => { void refreshWorkspace(); setPaletteOpen(false); }}>Refresh Workspace</button>
            <button onClick={() => { void createPlan(); setPaletteOpen(false); }}>Create Intent Plan Object</button>
            <button onClick={() => { void quickGitStatus(); setPaletteOpen(false); }}>Git Status + Diff Stat</button>
            <button onClick={() => { void quickVerify(); setPaletteOpen(false); }}>Verify Build</button>
            <button onClick={() => { void quickAgentStatus(); setPaletteOpen(false); }}>Agent Status</button>
          </div>
        </div>
      )}
    </div>
  );
}
