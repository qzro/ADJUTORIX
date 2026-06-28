import React, { useCallback, useMemo, useState } from "react";

type Rail = "explorer" | "search" | "source" | "verify" | "ledger" | "extensions";
type BottomPanel = "terminal" | "problems" | "output";
type RightPanel = "assistant" | "governance" | "timeline";

type WorkFile = {
  id: string;
  name: string;
  path: string;
  language: string;
  body: string;
  dirty: boolean;
};

type TerminalLine = {
  kind: "info" | "ok" | "warn" | "error" | "cmd";
  text: string;
};

type StatusMap = {
  workspace: string;
  plan: string;
  patch: string;
  verify: string;
  apply: string;
};


const seedFiles: WorkFile[] = [
  {
    id: "readme",
    name: "README.md",
    path: "README.md",
    language: "markdown",
    dirty: false,
    body: [
      "# Adjutorix",
      "",
      "Local governed coding control plane.",
      "",
      "Open a repository, capture intent, create plan objects, stage patch custody, verify before mutation, apply with receipts, and preserve the evidence timeline.",
      "",
      "This is the human workbench surface.",
    ].join("\n"),
  },
  {
    id: "intent",
    name: "intent.plan.json",
    path: ".adjutorix/objects/intent.plan.json",
    language: "json",
    dirty: false,
    body: JSON.stringify(
      {
        schema: "adjutorix.intent.plan.v1",
        workspace: null,
        intent: "",
        constraints: [],
        status: "draft",
      },
      null,
      2,
    ),
  },
  {
    id: "patch",
    name: "patch.custody.json",
    path: ".adjutorix/objects/patch.custody.json",
    language: "json",
    dirty: false,
    body: JSON.stringify(
      {
        schema: "adjutorix.patch.custody.v1",
        basis: null,
        files: [],
        status: "blocked_until_plan_exists",
      },
      null,
      2,
    ),
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getBridgeRoot(): Record<string, unknown> | null {
  const globalWindow = window as unknown as Record<string, unknown>;

  return (
    asRecord(globalWindow["adjutorix"]) ??
    asRecord(globalWindow["adjutorixAPI"]) ??
    asRecord(globalWindow["electronAPI"]) ??
    asRecord(globalWindow["api"])
  );
}

function getNestedFunction(root: Record<string, unknown>, dottedName: string): ((...args: unknown[]) => Promise<unknown> | unknown) | null {
  const parts = dottedName.split(".").filter(Boolean);
  let current: unknown = root;

  for (const part of parts.slice(0, -1)) {
    const currentRecord = asRecord(current);
    if (!currentRecord) return null;
    current = currentRecord[part];
  }

  const finalPart = parts[parts.length - 1];
  if (!finalPart) return null;

  const finalRecord = asRecord(current);
  if (!finalRecord) return null;

  const candidate = finalRecord[finalPart];
  return typeof candidate === "function"
    ? (candidate as (...args: unknown[]) => Promise<unknown> | unknown)
    : null;
}

async function callBridge(names: string[], ...args: unknown[]): Promise<unknown> {
  const root = getBridgeRoot();
  if (!root) {
    throw new Error("No preload bridge is exposed yet.");
  }

  for (const name of names) {
    const fn = getNestedFunction(root, name);
    if (fn) {
      return await fn(...args);
    }
  }

  throw new Error(`No bridge method found: ${names.join(", ")}`);
}

function coercePath(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  const object = asRecord(value);
  if (!object) return null;

  for (const key of ["path", "workspace", "root", "directory"]) {
    const possible = object[key];
    if (typeof possible === "string" && possible.trim()) {
      return possible;
    }
  }

  return null;
}

function statusClass(value: string): string {
  if (value === "OPEN" || value === "READY" || value === "OK") return "ok";
  if (value === "BLOCKED" || value === "MISSING") return "warn";
  return "info";
}

export function AdjutorixPowerWorkbench(): JSX.Element {
  const [rail, setRail] = useState<Rail>("explorer");
  const [bottom, setBottom] = useState<BottomPanel>("terminal");
  const [right, setRight] = useState<RightPanel>("assistant");
  const [files, setFiles] = useState<WorkFile[]>(seedFiles);
  const [activeId, setActiveId] = useState<string>("readme");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [terminalInput, setTerminalInput] = useState<string>("");
  const [intent, setIntent] = useState<string>("");
  const [assistantInput, setAssistantInput] = useState<string>("");
  const [terminal, setTerminal] = useState<TerminalLine[]>([
    { kind: "ok", text: "Adjutorix IDE workbench online." },
    { kind: "info", text: "Open a repository to activate explorer, editor, terminal, planning, verification, and apply gates." },
  ]);

  const activeFile = useMemo<WorkFile>(() => {
    return files.find((file) => file.id === activeId) ?? files[0] ?? seedFiles[0]!;
  }, [activeId, files]);

  const canOperate = workspace !== null;

  const status = useMemo<StatusMap>(() => {
    return {
      workspace: workspace ? "OPEN" : "MISSING",
      plan: intent.trim() ? "DRAFT" : "MISSING",
      patch: "MISSING",
      verify: "MISSING",
      apply: "BLOCKED",
    };
  }, [intent, workspace]);

  const appendTerminal = useCallback((kind: TerminalLine["kind"], text: string): void => {
    setTerminal((current) => [...current.slice(-220), { kind, text }]);
  }, []);

  const openRepository = useCallback(async (): Promise<void> => {
    appendTerminal("cmd", "open repository");

    try {
      const result = await callBridge([
        "workspace.open",
        "workspace.openRepository",
        "workspace.select",
        "openWorkspace",
        "openRepository",
        "selectWorkspace",
        "repository.open",
      ]);

      const resolvedPath = coercePath(result) ?? "WORKSPACE OPENED";
      setWorkspace(resolvedPath);
      appendTerminal("ok", `Workspace opened: ${resolvedPath}`);
    } catch (error) {
      appendTerminal("warn", error instanceof Error ? error.message : String(error));
      appendTerminal("info", "Workbench shell is active. Native open-repository bridge can be connected next.");
    }
  }, [appendTerminal]);

  const createPlanObject = useCallback((): void => {
    const body = JSON.stringify(
      {
        schema: "adjutorix.intent.plan.v1",
        workspace,
        intent: intent.trim() || "Describe the requested repository change here.",
        constraints: [
          "no direct write without patch custody",
          "verification before apply",
          "receipt after apply",
        ],
        status: workspace ? "ready_for_patch_custody" : "blocked_no_workspace",
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    );

    const file: WorkFile = {
      id: `plan-${Date.now()}`,
      name: "intent.plan.generated.json",
      path: ".adjutorix/objects/intent.plan.generated.json",
      language: "json",
      body,
      dirty: true,
    };

    setFiles((current) => [...current, file]);
    setActiveId(file.id);
    appendTerminal(workspace ? "ok" : "warn", workspace ? "Intent plan object staged." : "Plan staged, but workspace is missing.");
  }, [appendTerminal, intent, workspace]);

  const runCommand = useCallback(async (command: string): Promise<void> => {
    const trimmed = command.trim();
    if (!trimmed) return;

    appendTerminal("cmd", `$ ${trimmed}`);
    setTerminalInput("");

    try {
      const result = await callBridge(["terminal.run", "shell.run", "command.run", "runCommand"], trimmed);
      appendTerminal("ok", typeof result === "string" ? result : JSON.stringify(result, null, 2));
    } catch (error) {
      appendTerminal("warn", "Command bridge unavailable or denied.");
      appendTerminal("info", error instanceof Error ? error.message : String(error));
    }
  }, [appendTerminal]);

  const askAssistant = useCallback((): void => {
    const message = assistantInput.trim();
    if (!message) return;

    setAssistantInput("");
    appendTerminal("cmd", `assistant: ${message}`);
    appendTerminal("info", "Intent captured locally. Operator-kernel model bridge can be wired next.");
  }, [appendTerminal, assistantInput]);

  const updateActiveFile = useCallback((body: string): void => {
    setFiles((current) =>
      current.map((file) =>
        file.id === activeFile.id ? { ...file, body, dirty: true } : file,
      ),
    );
  }, [activeFile.id]);

  return (
    <div className="adjx-shell">
      <aside className="adjx-activity">
        <button className={rail === "explorer" ? "active" : ""} onClick={() => setRail("explorer")} title="Explorer">▱</button>
        <button className={rail === "search" ? "active" : ""} onClick={() => setRail("search")} title="Search">⌕</button>
        <button className={rail === "source" ? "active" : ""} onClick={() => setRail("source")} title="Source control">⑂</button>
        <button className={rail === "verify" ? "active" : ""} onClick={() => setRail("verify")} title="Verify">✓</button>
        <button className={rail === "ledger" ? "active" : ""} onClick={() => setRail("ledger")} title="Ledger">▣</button>
        <button className={rail === "extensions" ? "active" : ""} onClick={() => setRail("extensions")} title="Capabilities">✦</button>
      </aside>

      <aside className="adjx-sidebar">
        <div className="adjx-sidebar-header">
          <span>{rail.toUpperCase()}</span>
          <button onClick={() => void openRepository()}>Open</button>
        </div>

        <div className="adjx-workspace-card">
          <div className="muted">workspace</div>
          <strong>{workspace ?? "NO WORKSPACE"}</strong>
          <div className={`pill ${canOperate ? "ok" : "warn"}`}>{canOperate ? "OPERABLE" : "BLOCKED"}</div>
        </div>

        <div className="adjx-file-list">
          {files.map((file) => (
            <button key={file.id} className={file.id === activeId ? "active" : ""} onClick={() => setActiveId(file.id)}>
              <span>{file.dirty ? "● " : ""}{file.name}</span>
              <small>{file.path}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="adjx-main">
        <header className="adjx-titlebar">
          <div>
            <strong>ADJUTORIX</strong>
            <span>Cursor-class governed IDE workbench</span>
          </div>
          <div className="adjx-title-actions">
            <button onClick={() => setCommandPaletteOpen(true)}>Command Palette</button>
            <button onClick={createPlanObject}>Create Plan</button>
            <button disabled={!canOperate}>Verify</button>
            <button disabled={!canOperate}>Apply</button>
          </div>
        </header>

        <section className="adjx-tabbar">
          {files.slice(-8).map((file) => (
            <button key={file.id} className={file.id === activeId ? "active" : ""} onClick={() => setActiveId(file.id)}>
              {file.name}
            </button>
          ))}
        </section>

        <section className="adjx-editor-zone">
          <div className="adjx-editor-header">
            <span>{activeFile.path}</span>
            <span>{activeFile.language}</span>
          </div>
          <textarea
            className="adjx-code-editor"
            value={activeFile.body}
            spellCheck={false}
            onChange={(event) => updateActiveFile(event.target.value)}
          />
        </section>

        <section className="adjx-bottom">
          <div className="adjx-panel-tabs">
            {(["terminal", "problems", "output"] as BottomPanel[]).map((panel) => (
              <button key={panel} className={bottom === panel ? "active" : ""} onClick={() => setBottom(panel)}>
                {panel}
              </button>
            ))}
          </div>

          {bottom === "terminal" && (
            <div className="adjx-terminal">
              <div className="adjx-terminal-log">
                {terminal.map((line, index) => (
                  <div key={`${index}-${line.text}`} className={`line ${line.kind}`}>{line.text}</div>
                ))}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void runCommand(terminalInput); }}>
                <span>$</span>
                <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder="run governed command..." />
              </form>
            </div>
          )}

          {bottom === "problems" && (
            <div className="adjx-problems">
              <div className="problem warn">Workspace classification pending.</div>
              <div className="problem warn">Patch custody missing.</div>
              <div className="problem error">Apply gate blocked until verification receipt exists.</div>
            </div>
          )}

          {bottom === "output" && (
            <div className="adjx-output">
              <pre>{JSON.stringify(status, null, 2)}</pre>
            </div>
          )}
        </section>
      </main>

      <aside className="adjx-right">
        <div className="adjx-panel-tabs right-tabs">
          {(["assistant", "governance", "timeline"] as RightPanel[]).map((panel) => (
            <button key={panel} className={right === panel ? "active" : ""} onClick={() => setRight(panel)}>
              {panel}
            </button>
          ))}
        </div>

        {right === "assistant" && (
          <div className="adjx-assistant">
            <h2>Operator Assistant</h2>
            <p>Capture intent, plan safely, verify before mutation, and preserve receipts.</p>
            <textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="Describe the repository change..." />
            <button onClick={createPlanObject}>Stage Intent Plan</button>
            <div className="adjx-chatbox">
              <input
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") askAssistant();
                }}
                placeholder="Ask Adjutorix..."
              />
              <button onClick={askAssistant}>Send</button>
            </div>
          </div>
        )}

        {right === "governance" && (
          <div className="adjx-governance">
            <h2>Governance Gates</h2>
            {Object.entries(status).map(([key, value]) => (
              <div key={key} className="gate-row">
                <span>{key}</span>
                <strong className={statusClass(value)}>{value}</strong>
              </div>
            ))}
          </div>
        )}

        {right === "timeline" && (
          <div className="adjx-timeline">
            <h2>Evidence Timeline</h2>
            <div className="event ok">workbench booted</div>
            <div className="event warn">workspace not opened</div>
            <div className="event warn">apply blocked</div>
          </div>
        )}
      </aside>

      <footer className="adjx-statusbar">
        <span>Adjutorix</span>
        <span>{workspace ?? "NO WORKSPACE"}</span>
        <span>Plan: {status.plan}</span>
        <span>Verify: {status.verify}</span>
        <span>Apply: {status.apply}</span>
      </footer>

      {commandPaletteOpen && (
        <div className="adjx-palette-backdrop" onClick={() => setCommandPaletteOpen(false)}>
          <div className="adjx-palette" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              placeholder="Type a command..."
              onKeyDown={(event) => {
                if (event.key === "Escape") setCommandPaletteOpen(false);
                if (event.key === "Enter") {
                  appendTerminal("cmd", `palette: ${(event.target as HTMLInputElement).value}`);
                  setCommandPaletteOpen(false);
                }
              }}
            />
            <button onClick={() => void openRepository()}>Open Repository</button>
            <button onClick={createPlanObject}>Create Intent Plan Object</button>
            <button onClick={() => setRight("governance")}>Show Governance Gates</button>
            <button onClick={() => setBottom("terminal")}>Focus Terminal</button>
          </div>
        </div>
      )}
    </div>
  );
}
