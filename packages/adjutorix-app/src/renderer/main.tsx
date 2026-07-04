import Editor from "@monaco-editor/react";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/adjutorix-power-workbench.css";

type FileKind = "source" | "test" | "config" | "doc" | "asset" | "lock" | "other";

type WorkspaceFile = {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
};

type SearchHit = {
  path: string;
  line: number;
  preview: string;
};

type WorkspaceOS = {
  defaults: () => Promise<{
    ok: boolean;
    source: string;
    cwd: string;
    home: string;
    envWorkspace: string;
    providers: Record<string, boolean>;
  }>;
  scan: (workspace: string) => Promise<{
    ok: boolean;
    source: string;
    workspace: string;
    fileCount: number;
    truncated: boolean;
    files: WorkspaceFile[];
  }>;
  readText: (input: { workspace: string; path: string }) => Promise<{ ok: boolean; path: string; content: string }>;
  writeText: (input: { workspace: string; path: string; content: string }) => Promise<unknown>;
  createFile: (input: { workspace: string; path: string; content?: string }) => Promise<unknown>;
  makeDirectory: (input: { workspace: string; path: string }) => Promise<unknown>;
  movePath: (input: { workspace: string; from: string; to: string }) => Promise<unknown>;
  trashPath: (input: { workspace: string; path: string }) => Promise<unknown>;
  searchText: (input: { workspace: string; query: string }) => Promise<{ ok: boolean; matches: SearchHit[] }>;
  gitStatus: (workspace: string) => Promise<{ ok: boolean; output: string }>;
  gitDiff: (input: { workspace: string; path?: string }) => Promise<{ ok: boolean; output: string }>;
  run: (input: { workspace: string; command: string; timeoutMs?: number }) => Promise<{
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    command: string;
    workspace: string;
  }>;
};

declare global {
  interface Window {
    adjutorixWorkspaceOS?: WorkspaceOS;
  }
}

const ACTIONS = [
  { label: "Status", command: "pwd; git status --short 2>/dev/null || true; git log --oneline --decorate --max-count=8 2>/dev/null || true" },
  { label: "Install App", command: "ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh" },
  { label: "Verify", command: "bash scripts/check.sh" },
  { label: "Build", command: "pnpm -r --if-present run build" },
  { label: "Test", command: "pnpm --filter @adjutorix/app test -- --run" },
  { label: "Agent Status", command: "bash scripts/agent/status.sh || true" },
  { label: "Agent Restart", command: "bash scripts/agent/restart.sh || true" },
  { label: "Power Plane", command: "pnpm power:verify && pnpm power:plane" },
];

function bridge(): WorkspaceOS {
  const api = window.adjutorixWorkspaceOS;
  if (!api) throw new Error("adjutorixWorkspaceOS bridge unavailable");
  return api;
}

function languageFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".sql")) return "sql";
  return "plaintext";
}

function rank(file: WorkspaceFile): number {
  if (file.path === "README.md") return -10;
  if (file.path === "package.json") return -9;
  if (file.path.startsWith("packages/adjutorix-app/src/renderer/main")) return -8;
  const ranks: Record<FileKind, number> = { source: 0, test: 1, config: 2, doc: 3, lock: 4, asset: 5, other: 6 };
  return ranks[file.kind];
}

function App(): JSX.Element {
  const [workspace, setWorkspace] = useState(localStorage.getItem("adjutorix.workspaceOs.path") ?? "");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string>("");
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState(ACTIONS[0]?.command ?? "pwd");
  const [output, setOutput] = useState("Adjutorix Workspace OS ready. Connect a folder. No single-folder binding. No fake AI claim.");
  const [searchNeedle, setSearchNeedle] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return files
      .filter((file) => {
        if (kind !== "all" && file.kind !== kind) return false;
        if (!needle) return true;
        return file.path.toLowerCase().includes(needle) || file.name.toLowerCase().includes(needle);
      })
      .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  }, [files, kind, query]);

  const activeContent = activePath ? buffers[activePath] ?? "" : "";
  const dirtyActive = Boolean(activePath && dirty.includes(activePath));

  function print(text: string): void {
    setOutput(text.slice(-220000));
  }

  async function refresh(path = workspace): Promise<void> {
    const target = path.trim();
    if (!target) {
      print("CONNECT BLOCKED\nPaste a project folder path.");
      return;
    }

    setBusy(true);
    try {
      const result = await bridge().scan(target);
      localStorage.setItem("adjutorix.workspaceOs.path", result.workspace);
      setWorkspace(result.workspace);
      setFiles(result.files);

      const preferred =
        result.files.find((file) => file.path === "README.md") ??
        result.files.find((file) => file.path === "package.json") ??
        result.files.find((file) => file.path.includes("/src/") && file.kind === "source") ??
        result.files.find((file) => file.kind === "source") ??
        result.files[0];

      console.info("ADJUTORIX_WORKSPACE_OS_READY", JSON.stringify({ workspace: result.workspace, files: result.fileCount, source: result.source }));
      console.info("ADJUTORIX_FIXED_WORKSPACE_READY", JSON.stringify({ workspace: result.workspace, files: result.fileCount, source: result.source }));
      console.info("ADJUTORIX_UNIVERSAL_WORKSPACE_READY", JSON.stringify({ workspace: result.workspace, files: result.fileCount, source: result.source }));

      print(`WORKSPACE OS CONNECTED\n${result.workspace}\nfiles=${result.fileCount}\nsource=${result.source}`);

      if (preferred) {
        await openFile(preferred.path, result.workspace);
      }
    } catch (error) {
      print(`CONNECT FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(path: string, currentWorkspace = workspace): Promise<void> {
    setBusy(true);
    try {
      const result = await bridge().readText({ workspace: currentWorkspace, path });
      setBuffers((previous) => ({ ...previous, [path]: result.content }));
      setTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
      setActivePath(path);
      print(`OPENED\n${path}\n${result.content.length} characters`);
    } catch (error) {
      print(`OPEN FAILED\n${path}\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveActive(): Promise<void> {
    if (!activePath) {
      print("SAVE BLOCKED\nNo active file.");
      return;
    }

    setBusy(true);
    try {
      const result = await bridge().writeText({ workspace, path: activePath, content: activeContent });
      setDirty((previous) => previous.filter((item) => item !== activePath));
      print(`SAVED\n${JSON.stringify(result, null, 2)}`);
      await refresh(workspace);
    } catch (error) {
      print(`SAVE FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createFile(): Promise<void> {
    const path = pathInput.trim();

    if (!path) {
      print("CREATE FILE BLOCKED\nEnter a relative file path in the path input.");
      return;
    }

    setBusy(true);
    try {
      await bridge().createFile({ workspace, path, content: "" });
      setPathInput("");
      await refresh(workspace);
      await openFile(path, workspace);
    } catch (error) {
      print(`CREATE FILE FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createFolder(): Promise<void> {
    const path = pathInput.trim();

    if (!path) {
      print("CREATE FOLDER BLOCKED\nEnter a relative folder path in the path input.");
      return;
    }

    setBusy(true);
    try {
      const result = await bridge().makeDirectory({ workspace, path });
      setPathInput("");
      print(`FOLDER CREATED\n${JSON.stringify(result, null, 2)}`);
      await refresh(workspace);
    } catch (error) {
      print(`CREATE FOLDER FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function renameActive(): Promise<void> {
    if (!activePath) {
      print("MOVE BLOCKED\nNo active file.");
      return;
    }

    const next = pathInput.trim();

    if (!next) {
      setPathInput(activePath);
      print("MOVE ARMED\nEdit the path input to the destination path, then press Move again.");
      return;
    }

    if (next === activePath) {
      print("MOVE BLOCKED\nDestination equals current path.");
      return;
    }

    setBusy(true);
    try {
      const result = await bridge().movePath({ workspace, from: activePath, to: next });
      setTabs((previous) => previous.map((item) => (item === activePath ? next : item)));
      setBuffers((previous) => {
        const copy = { ...previous, [next]: previous[activePath] ?? "" };
        delete copy[activePath];
        return copy;
      });
      setPathInput("");
      setActivePath(next);
      print(`MOVED\n${JSON.stringify(result, null, 2)}`);
      await refresh(workspace);
    } catch (error) {
      print(`MOVE FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function trashActive(): Promise<void> {
    if (!activePath) {
      print("TRASH BLOCKED\nNo active file.");
      return;
    }

    if (pathInput.trim() !== activePath) {
      setPathInput(activePath);
      print("TRASH ARMED\nThe active path has been copied into the path input. Press Trash Safe again to move it to .adjutorix-trash.");
      return;
    }

    setBusy(true);
    try {
      const result = await bridge().trashPath({ workspace, path: activePath });
      setTabs((previous) => previous.filter((item) => item !== activePath));
      setBuffers((previous) => {
        const copy = { ...previous };
        delete copy[activePath];
        return copy;
      });
      setPathInput("");
      setActivePath("");
      print(`TRASHED\n${JSON.stringify(result, null, 2)}`);
      await refresh(workspace);
    } catch (error) {
      print(`TRASH FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(nextCommand = command): Promise<void> {
    if (!workspace.trim()) {
      print("RUN BLOCKED\nConnect a workspace first.");
      return;
    }

    setBusy(true);
    setCommand(nextCommand);
    try {
      const result = await bridge().run({ workspace, command: nextCommand, timeoutMs: 900000 });
      print([`$ ${result.command}`, `workspace=${result.workspace}`, `ok=${result.ok} exit=${result.exitCode} timedOut=${result.timedOut}`, "", result.stdout, result.stderr ? `\n--- stderr ---\n${result.stderr}` : ""].join("\n"));
    } catch (error) {
      print(`COMMAND FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function gitStatus(): Promise<void> {
    setBusy(true);
    try {
      const result = await bridge().gitStatus(workspace);
      print(result.output.trim() || "Git status clean.");
    } catch (error) {
      print(`GIT STATUS FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function gitDiff(): Promise<void> {
    setBusy(true);
    try {
      const result = await bridge().gitDiff({ workspace, path: activePath || undefined });
      print(result.output.trim() || "No diff.");
    } catch (error) {
      print(`GIT DIFF FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function searchWorkspace(): Promise<void> {
    if (!searchNeedle.trim()) return;

    setBusy(true);
    try {
      const result = await bridge().searchText({ workspace, query: searchNeedle });
      setSearchHits(result.matches);
      print(`SEARCH COMPLETE\nquery=${searchNeedle}\nhits=${result.matches.length}`);
    } catch (error) {
      print(`SEARCH FAILED\n${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    document.body.dataset.adjutorixWorkspaceOs = "true";
    console.info("ADJUTORIX_WORKSPACE_OS_MOUNTED");
    console.info("ADJUTORIX_FIXED_WORKSPACE_MOUNTED");

    void bridge().defaults().then((defaults) => {
      setProviders(defaults.providers);
      const chosen = defaults.envWorkspace || localStorage.getItem("adjutorix.workspaceOs.path") || "";
      if (chosen) {
        setWorkspace(chosen);
        void refresh(chosen);
      }
    });
  }, []);

  return (
    <main className="os-shell adj-shell">
      <aside className="os-rail">
        <div className="os-brand">
          <div className="os-mark">A</div>
          <div>
            <strong>Adjutorix OS</strong>
            <span>workspace runtime</span>
          </div>
        </div>

        <div className="os-connect">
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="/path/to/project" spellCheck={false} />
          <button disabled={busy} onClick={() => void refresh()}>Connect</button>
        </div>

        <div className="os-provider-grid">
          {Object.entries(providers).map(([name, enabled]) => (
            <div key={name} className={enabled ? "ok" : "missing"}>
              <b>{name}</b>
              <span>{enabled ? "ready" : "not wired"}</span>
            </div>
          ))}
        </div>

        <div className="os-tools">
          <button disabled={busy} onClick={() => void createFile()}>New File</button>
          <button disabled={busy} onClick={() => void createFolder()}>New Folder</button>
          <button disabled={busy || !activePath} onClick={() => void renameActive()}>Move</button>
          <button disabled={busy || !activePath} onClick={() => void trashActive()}>Trash Safe</button>
        </div>

        <input
          className="os-path-input"
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          placeholder="New / move / trash relative path..."
          spellCheck={false}
        />

        <input className="os-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter files..." spellCheck={false} />

        <div className="os-filters">
          {(["all", "source", "test", "config", "doc", "lock", "asset", "other"] as const).map((item) => (
            <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item}</button>
          ))}
        </div>

        <div className="os-files">
          {filtered.slice(0, 1500).map((file) => (
            <button key={file.path} className={activePath === file.path ? "os-file active" : "os-file"} onClick={() => void openFile(file.path)} title={file.path}>
              <b>{file.kind}</b>
              <strong>{file.name}</strong>
              <span>{file.path}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="os-main">
        <header className="os-tabs">
          <div className="os-tab-list">
            {tabs.map((tab) => (
              <button key={tab} className={activePath === tab ? "tab active" : "tab"} onClick={() => setActivePath(tab)} title={tab}>
                {dirty.includes(tab) ? "● " : ""}{tab.split("/").pop()}
              </button>
            ))}
          </div>
          <div className="os-editor-actions">
            <button disabled={busy || !activePath || !dirtyActive} onClick={() => void saveActive()}>Save</button>
            <button disabled={busy || !workspace} onClick={() => void gitDiff()}>Diff</button>
            <button disabled={busy || !workspace} onClick={() => void gitStatus()}>Git</button>
          </div>
        </header>

        <div className="os-pathline" title={activePath || workspace}>
          {activePath || "No file open"}
        </div>

        <div className="os-editor">
          {activePath ? (
            <Editor
              value={activeContent}
              language={languageFor(activePath)}
              theme="vs-dark"
              options={{
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
              onChange={(value) => {
                const next = value ?? "";
                setBuffers((previous) => ({ ...previous, [activePath]: next }));
                setDirty((previous) => (previous.includes(activePath) ? previous : [...previous, activePath]));
              }}
            />
          ) : (
            <div className="os-empty">Open a file from the workspace.</div>
          )}
        </div>
      </section>

      <aside className="os-command">
        <header>
          <strong>Runway</strong>
          <span>{busy ? "running" : "idle"}</span>
        </header>

        <div className="os-action-grid">
          {ACTIONS.map((action) => (
            <button key={action.label} disabled={busy || !workspace} onClick={() => void runCommand(action.command)}>
              {action.label}
            </button>
          ))}
        </div>

        <textarea value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} />

        <button className="os-run" disabled={busy || !workspace} onClick={() => void runCommand()}>
          Run Command
        </button>

        <div className="os-search-run">
          <input value={searchNeedle} onChange={(event) => setSearchNeedle(event.target.value)} placeholder="Search text in workspace..." spellCheck={false} />
          <button disabled={busy || !workspace} onClick={() => void searchWorkspace()}>Search</button>
        </div>

        <div className="os-search-hits">
          {searchHits.slice(0, 80).map((hit) => (
            <button key={`${hit.path}:${hit.line}:${hit.preview}`} onClick={() => void openFile(hit.path)}>
              <strong>{hit.path}:{hit.line}</strong>
              <span>{hit.preview}</span>
            </button>
          ))}
        </div>

        <pre>{output}</pre>
      </aside>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) throw new Error("Adjutorix root element not found");

createRoot(root).render(<App />);


/**
 * ADJUTORIX_AI_ASSISTANT_PANEL_V1
 *
 * Imperative overlay mounted beside the workspace OS shell.
 * It uses the preload provider bridge and never fabricates availability.
 */

type AdjutorixAiProviderName = "ollama" | "openai" | "anthropic";

interface AdjutorixAiCompleteResult {
  ok: boolean;
  provider: AdjutorixAiProviderName;
  model: string;
  text: string;
  error?: string;
  elapsedMs: number;
}

interface AdjutorixAiProviderRecord {
  configured: boolean;
  available: boolean;
  provider: AdjutorixAiProviderName;
  model: string;
  endpoint: string;
  reason?: string;
}

interface AdjutorixAiStatusResult {
  ok: boolean;
  providers: Record<AdjutorixAiProviderName, AdjutorixAiProviderRecord>;
}

interface AdjutorixAiBridge {
  status: () => Promise<AdjutorixAiStatusResult>;
  complete: (request: {
    provider?: AdjutorixAiProviderName;
    prompt: string;
    workspace?: string;
    context?: string;
    instruction?: string;
  }) => Promise<AdjutorixAiCompleteResult>;
}

declare global {
  interface Window {
    adjutorixAI?: AdjutorixAiBridge;
  }
}

function adjutorixAiWorkspaceFromLocation(): string {
  const titleText = document.title || "Adjutorix";
  const workspaceText = window.localStorage.getItem("adjutorix.workspace") || "";
  return workspaceText || titleText;
}

function installAdjutorixAiAssistantPanel(): void {
  if (document.getElementById("adjutorix-ai-assistant")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-assistant";
  panel.className = "adjutorix-ai-assistant";
  panel.setAttribute("aria-label", "Adjutorix AI assistant");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-header";

  const title = document.createElement("strong");
  title.textContent = "AI Workbench Bridge";

  const provider = document.createElement("select");
  provider.className = "adjutorix-ai-provider";
  for (const value of ["ollama", "openai", "anthropic"] as AdjutorixAiProviderName[]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    provider.appendChild(option);
  }

  header.appendChild(title);
  header.appendChild(provider);

  const prompt = document.createElement("textarea");
  prompt.className = "adjutorix-ai-prompt";
  prompt.placeholder = "Ask for a code action, diagnosis, refactor, command sequence, or patch plan...";
  prompt.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-actions";

  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.textContent = "Provider Status";

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.textContent = "Run AI";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Output";

  actions.appendChild(statusButton);
  actions.appendChild(runButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-output";
  output.textContent = "Provider bridge mounted. Run status first.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  statusButton.addEventListener("click", () => {
    void (async () => {
      const bridge = window.adjutorixAI;

      if (!bridge) {
        setOutput("AI bridge unavailable on window.adjutorixAI.");
        return;
      }

      statusButton.setAttribute("disabled", "true");
      try {
        const result = await bridge.status();
        setOutput(JSON.stringify(result, null, 2));
        console.log("ADJUTORIX_AI_PROVIDER_STATUS", JSON.stringify(result));
      } catch (error) {
        setOutput(`AI STATUS FAILED\n${String(error)}`);
      } finally {
        statusButton.removeAttribute("disabled");
      }
    })();
  });

  runButton.addEventListener("click", () => {
    void (async () => {
      const bridge = window.adjutorixAI;
      const text = prompt.value.trim();

      if (!bridge) {
        setOutput("AI bridge unavailable on window.adjutorixAI.");
        return;
      }

      if (!text) {
        setOutput("Enter a request before running AI.");
        return;
      }

      runButton.setAttribute("disabled", "true");
      setOutput("Running provider call...");

      try {
        const result = await bridge.complete({
          provider: provider.value as AdjutorixAiProviderName,
          prompt: text,
          workspace: adjutorixAiWorkspaceFromLocation(),
          instruction: "Return executable developer guidance for Adjutorix. Include file paths, shell commands, test commands, and risk notes. Do not claim execution.",
        });

        setOutput(JSON.stringify(result, null, 2));
        console.log("ADJUTORIX_AI_PROVIDER_COMPLETION", JSON.stringify({
          ok: result.ok,
          provider: result.provider,
          model: result.model,
          elapsedMs: result.elapsedMs,
        }));
      } catch (error) {
        setOutput(`AI RUN FAILED\n${String(error)}`);
      } finally {
        runButton.removeAttribute("disabled");
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(prompt);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_ASSISTANT_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-provider-bridge",
    providers: ["ollama", "openai", "anthropic"],
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiAssistantPanel, { once: true });
} else {
  installAdjutorixAiAssistantPanel();
}
