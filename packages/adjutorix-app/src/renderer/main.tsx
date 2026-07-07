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


/**
 * ADJUTORIX_AI_PATCH_RUNWAY_V1
 *
 * Real AI-to-patch runway:
 * - Builds strict JSON edit prompts from a target file.
 * - Calls the already-mounted adjutorixAI provider bridge.
 * - Applies only explicit JSON full-file edits.
 * - Requires manual APPLY confirmation before mutation.
 * - Uses adjutorixWorkspaceOS.writeText, so mutations remain in the local workspace bridge.
 */

type AdjutorixPatchProviderName = "ollama" | "openai" | "anthropic";

interface AdjutorixPatchDefaults {
  workspace?: string;
}

interface AdjutorixPatchReadResult {
  content?: string;
  path?: string;
}

interface AdjutorixPatchEdit {
  path: string;
  content: string;
  reason?: string;
}

interface AdjutorixPatchPlan {
  edits: AdjutorixPatchEdit[];
  commands?: string[];
  risks?: string[];
}

interface AdjutorixPatchWorkspaceBridge {
  defaults?: () => Promise<AdjutorixPatchDefaults>;
  readText?: (request: { workspace?: string; path: string }) => Promise<AdjutorixPatchReadResult>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
  gitDiff?: (request: { workspace?: string }) => Promise<unknown>;
}

interface AdjutorixPatchAiBridge {
  complete?: (request: {
    provider?: AdjutorixPatchProviderName;
    prompt: string;
    workspace?: string;
    context?: string;
    instruction?: string;
  }) => Promise<{ ok: boolean; provider: string; model: string; text: string; error?: string; elapsedMs: number }>;
}

type AdjutorixPatchRuntimeWindow = {
  adjutorixWorkspaceOS?: AdjutorixPatchWorkspaceBridge;
  adjutorixAI?: AdjutorixPatchAiBridge;
};

function adjutorixPatchWindow(): AdjutorixPatchRuntimeWindow {
  return window as unknown as AdjutorixPatchRuntimeWindow;
}

async function adjutorixPatchWorkspace(): Promise<string> {
  const bridge = adjutorixPatchWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  const defaults = await bridge.defaults();
  return typeof defaults.workspace === "string" ? defaults.workspace : "";
}

function adjutorixPatchExtractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

function adjutorixPatchParsePlan(text: string): AdjutorixPatchPlan {
  const parsed = JSON.parse(adjutorixPatchExtractJson(text)) as AdjutorixPatchPlan;

  if (!Array.isArray(parsed.edits)) {
    throw new Error("Patch JSON must contain edits array.");
  }

  for (const edit of parsed.edits) {
    if (typeof edit.path !== "string" || !edit.path.trim()) {
      throw new Error("Every edit requires a non-empty path.");
    }

    if (typeof edit.content !== "string") {
      throw new Error(`Edit for ${edit.path} requires full replacement content string.`);
    }
  }

  return parsed;
}

function installAdjutorixAiPatchRunway(): void {
  if (document.getElementById("adjutorix-ai-patch-runway")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-patch-runway";
  panel.className = "adjutorix-ai-patch-runway";
  panel.setAttribute("aria-label", "Adjutorix AI patch runway");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-patch-header";

  const title = document.createElement("strong");
  title.textContent = "AI Patch Runway";

  const provider = document.createElement("select");
  provider.className = "adjutorix-ai-patch-provider";

  for (const value of ["ollama", "openai", "anthropic"] as AdjutorixPatchProviderName[]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    provider.appendChild(option);
  }

  header.appendChild(title);
  header.appendChild(provider);

  const pathInput = document.createElement("input");
  pathInput.className = "adjutorix-ai-patch-path";
  pathInput.placeholder = "Target file path, e.g. packages/adjutorix-app/src/renderer/main.tsx";
  pathInput.spellcheck = false;

  const instruction = document.createElement("textarea");
  instruction.className = "adjutorix-ai-patch-instruction";
  instruction.placeholder = "Describe the code change. AI must return strict JSON with full-file replacement edits.";
  instruction.spellcheck = false;

  const confirmation = document.createElement("input");
  confirmation.className = "adjutorix-ai-patch-confirm";
  confirmation.placeholder = "Type APPLY to allow mutation";
  confirmation.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-patch-actions";

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.textContent = "Load File";

  const askButton = document.createElement("button");
  askButton.type = "button";
  askButton.textContent = "Ask AI JSON";

  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.textContent = "Apply JSON";

  const diffButton = document.createElement("button");
  diffButton.type = "button";
  diffButton.textContent = "Git Diff";

  actions.appendChild(loadButton);
  actions.appendChild(askButton);
  actions.appendChild(applyButton);
  actions.appendChild(diffButton);

  const output = document.createElement("textarea");
  output.className = "adjutorix-ai-patch-output";
  output.placeholder = "Loaded file context, AI JSON patch plan, apply result, or git diff appears here.";
  output.spellcheck = false;

  function setOutput(value: string): void {
    output.value = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  loadButton.addEventListener("click", () => {
    void (async () => {
      const osBridge = adjutorixPatchWindow().adjutorixWorkspaceOS;
      const path = pathInput.value.trim();

      if (!osBridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!path) {
        setOutput("Enter a target file path.");
        return;
      }

      setBusy(loadButton, true);
      try {
        const workspace = await adjutorixPatchWorkspace();
        const result = await osBridge.readText({ workspace, path });
        setOutput(String(result.content || ""));
        console.log("ADJUTORIX_AI_PATCH_FILE_LOADED", JSON.stringify({ path, workspace, bytes: String(result.content || "").length }));
      } catch (error) {
        setOutput(`LOAD FILE FAILED\n${String(error)}`);
      } finally {
        setBusy(loadButton, false);
      }
    })();
  });

  askButton.addEventListener("click", () => {
    void (async () => {
      const aiBridge = adjutorixPatchWindow().adjutorixAI;
      const path = pathInput.value.trim();
      const request = instruction.value.trim();
      const currentContent = output.value;

      if (!aiBridge?.complete) {
        setOutput("AI provider bridge unavailable.");
        return;
      }

      if (!path || !request) {
        setOutput("Enter target file path and patch instruction.");
        return;
      }

      setBusy(askButton, true);
      try {
        const workspace = await adjutorixPatchWorkspace();
        const prompt = [
          "Return STRICT JSON only. No markdown.",
          "Schema:",
          '{"edits":[{"path":"relative/path","content":"FULL replacement file content","reason":"why"}],"commands":["verification command"],"risks":["risk note"]}',
          "",
          `Target path: ${path}`,
          "",
          "Instruction:",
          request,
          "",
          "Current file content:",
          currentContent,
        ].join("\n");

        const result = await aiBridge.complete({
          provider: provider.value as AdjutorixPatchProviderName,
          workspace,
          prompt,
          instruction: "You are Adjutorix AI Patch Runway. Return strict JSON only. Every edit must contain full replacement content. Do not claim execution.",
        });

        setOutput(result.text || JSON.stringify(result, null, 2));
        console.log("ADJUTORIX_AI_PATCH_PLAN_CREATED", JSON.stringify({
          ok: result.ok,
          provider: result.provider,
          model: result.model,
          elapsedMs: result.elapsedMs,
          path,
        }));
      } catch (error) {
        setOutput(`AI PATCH PLAN FAILED\n${String(error)}`);
      } finally {
        setBusy(askButton, false);
      }
    })();
  });

  applyButton.addEventListener("click", () => {
    void (async () => {
      const osBridge = adjutorixPatchWindow().adjutorixWorkspaceOS;

      if (!osBridge?.writeText) {
        setOutput("Workspace OS write bridge unavailable.");
        return;
      }

      if (confirmation.value.trim() !== "APPLY") {
        setOutput("Mutation blocked. Type APPLY in the confirmation field before applying JSON edits.");
        return;
      }

      setBusy(applyButton, true);
      try {
        const workspace = await adjutorixPatchWorkspace();
        const plan = adjutorixPatchParsePlan(output.value);
        const applied: string[] = [];

        for (const edit of plan.edits) {
          await osBridge.writeText({ workspace, path: edit.path, content: edit.content });
          applied.push(edit.path);
        }

        confirmation.value = "";
        setOutput(JSON.stringify({ ok: true, applied, commands: plan.commands || [], risks: plan.risks || [] }, null, 2));
        console.log("ADJUTORIX_AI_PATCH_APPLIED", JSON.stringify({ applied, workspace, source: "adjutorix-ai-patch-runway" }));
      } catch (error) {
        setOutput(`APPLY JSON FAILED\n${String(error)}`);
      } finally {
        setBusy(applyButton, false);
      }
    })();
  });

  diffButton.addEventListener("click", () => {
    void (async () => {
      const osBridge = adjutorixPatchWindow().adjutorixWorkspaceOS;

      if (!osBridge?.gitDiff) {
        setOutput("Workspace OS git diff bridge unavailable.");
        return;
      }

      setBusy(diffButton, true);
      try {
        const workspace = await adjutorixPatchWorkspace();
        const diff = await osBridge.gitDiff({ workspace });
        setOutput(typeof diff === "string" ? diff : JSON.stringify(diff, null, 2));
        console.log("ADJUTORIX_AI_PATCH_DIFF_READY", JSON.stringify({ workspace, source: "adjutorix-ai-patch-runway" }));
      } catch (error) {
        setOutput(`GIT DIFF FAILED\n${String(error)}`);
      } finally {
        setBusy(diffButton, false);
      }
    })();
  });

  panel.appendChild(header);
  panel.appendChild(pathInput);
  panel.appendChild(instruction);
  panel.appendChild(confirmation);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_PATCH_RUNWAY_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-patch-runway",
    requires: "manual-apply-confirmation",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiPatchRunway, { once: true });
} else {
  installAdjutorixAiPatchRunway();
}


/**
 * ADJUTORIX_AI_PATCH_VERIFY_RUNWAY_V1
 *
 * Adds real post-patch verification execution:
 * - Parses commands from the AI patch JSON output.
 * - Requires manual RUN confirmation.
 * - Executes through adjutorixWorkspaceOS.run.
 * - Captures outputs as evidence in the panel.
 */

interface AdjutorixVerifyRunCommandResult {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  code?: number;
  ok?: boolean;
  elapsedMs?: number;
}

interface AdjutorixVerifyRunWorkspaceBridge {
  defaults?: () => Promise<{ workspace?: string }>;
  run?: (request: { workspace?: string; command: string }) => Promise<AdjutorixVerifyRunCommandResult>;
}

interface AdjutorixVerifyRunRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixVerifyRunWorkspaceBridge;
}

function adjutorixVerifyRunWindow(): AdjutorixVerifyRunRuntimeWindow {
  return window as unknown as AdjutorixVerifyRunRuntimeWindow;
}

function adjutorixVerifyRunExtractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

function adjutorixVerifyRunExtractCommands(text: string): string[] {
  const parsed = JSON.parse(adjutorixVerifyRunExtractJson(text)) as { commands?: unknown };
  const commands = Array.isArray(parsed.commands) ? parsed.commands : [];

  return commands
    .filter((command): command is string => typeof command === "string")
    .map((command) => command.trim())
    .filter(Boolean);
}

async function adjutorixVerifyRunWorkspace(): Promise<string> {
  const bridge = adjutorixVerifyRunWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  const defaults = await bridge.defaults();
  return typeof defaults.workspace === "string" ? defaults.workspace : "";
}

function installAdjutorixAiPatchVerifyRunway(): void {
  if (document.getElementById("adjutorix-ai-patch-verify-runway")) {
    return;
  }

  const patchPanel = document.getElementById("adjutorix-ai-patch-runway");
  const anchor = patchPanel || document.body;

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-patch-verify-runway";
  panel.className = "adjutorix-ai-patch-verify-runway";
  panel.setAttribute("aria-label", "Adjutorix AI patch verify runway");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-patch-verify-header";

  const title = document.createElement("strong");
  title.textContent = "Patch Verify";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-patch-verify-confirm";
  confirm.placeholder = "Type RUN";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const commands = document.createElement("textarea");
  commands.className = "adjutorix-ai-patch-verify-commands";
  commands.placeholder = "Commands. One per line. Or click Extract JSON Commands from patch runway output.";
  commands.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-patch-verify-actions";

  const extractButton = document.createElement("button");
  extractButton.type = "button";
  extractButton.textContent = "Extract JSON Commands";

  const defaultButton = document.createElement("button");
  defaultButton.type = "button";
  defaultButton.textContent = "Default Checks";

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.textContent = "Run Verify";

  actions.appendChild(extractButton);
  actions.appendChild(defaultButton);
  actions.appendChild(runButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-patch-verify-output";
  output.textContent = "Verification runway mounted. Type RUN before executing commands.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  extractButton.addEventListener("click", () => {
    const source = document.querySelector<HTMLTextAreaElement>(".adjutorix-ai-patch-output");

    if (!source) {
      setOutput("Patch runway output not found.");
      return;
    }

    try {
      const extracted = adjutorixVerifyRunExtractCommands(source.value);
      commands.value = extracted.join("\n");
      setOutput(JSON.stringify({ ok: true, commandCount: extracted.length, commands: extracted }, null, 2));
      console.log("ADJUTORIX_AI_PATCH_VERIFY_COMMANDS_EXTRACTED", JSON.stringify({ commandCount: extracted.length }));
    } catch (error) {
      setOutput(`COMMAND EXTRACTION FAILED\n${String(error)}`);
    }
  });

  defaultButton.addEventListener("click", () => {
    commands.value = [
      "pnpm --filter @adjutorix/app run build:ts",
      "pnpm --filter @adjutorix/app run lint",
      "bash scripts/check.sh",
    ].join("\n");

    setOutput("Default verification commands loaded.");
  });

  runButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixVerifyRunWindow().adjutorixWorkspaceOS;

      if (!bridge?.run) {
        setOutput("Workspace OS run bridge unavailable.");
        return;
      }

      if (confirm.value.trim() !== "RUN") {
        setOutput("Command execution blocked. Type RUN in the confirmation field.");
        return;
      }

      const planned = commands.value
        .split("\n")
        .map((command) => command.trim())
        .filter(Boolean);

      if (!planned.length) {
        setOutput("No commands to run.");
        return;
      }

      setBusy(runButton, true);

      const workspace = await adjutorixVerifyRunWorkspace();
      const results: Array<{ command: string; result: AdjutorixVerifyRunCommandResult | { error: string } }> = [];

      try {
        for (const command of planned) {
          setOutput(JSON.stringify({ running: command, completed: results.length, total: planned.length }, null, 2));

          try {
            const result = await bridge.run({ workspace, command });
            results.push({ command, result });
          } catch (error) {
            results.push({ command, result: { error: String(error) } });
            break;
          }
        }

        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, workspace, results }, null, 2));
        console.log("ADJUTORIX_AI_PATCH_VERIFY_RUN_COMPLETED", JSON.stringify({
          source: "adjutorix-ai-patch-verify-runway",
          commandCount: planned.length,
          resultCount: results.length,
          workspace,
        }));
      } finally {
        setBusy(runButton, false);
      }
    })();
  });

  panel.appendChild(header);
  panel.appendChild(commands);
  panel.appendChild(actions);
  panel.appendChild(output);

  if (patchPanel?.parentElement) {
    patchPanel.parentElement.appendChild(panel);
  } else {
    anchor.appendChild(panel);
  }

  console.log("ADJUTORIX_AI_PATCH_VERIFY_RUNWAY_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-patch-verify-runway",
    requires: "manual-run-confirmation",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiPatchVerifyRunway, { once: true });
} else {
  installAdjutorixAiPatchVerifyRunway();
}


/**
 * ADJUTORIX_AI_RUNWAY_EVIDENCE_RECORDER_V1
 *
 * Records local evidence for the AI patch runway:
 * - patch JSON/current patch output
 * - verify commands
 * - verify command output
 * - optional git diff snapshot
 * - workspace and timestamp
 * - manual RECORD confirmation
 *
 * Evidence is written through adjutorixWorkspaceOS.writeText into:
 * .adjutorix-ai-runway/<timestamp>-evidence.json
 */

interface AdjutorixEvidenceWorkspaceBridge {
  defaults?: () => Promise<{ workspace?: string }>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
  gitDiff?: (request: { workspace?: string }) => Promise<unknown>;
}

interface AdjutorixEvidenceRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixEvidenceWorkspaceBridge;
}

function adjutorixEvidenceWindow(): AdjutorixEvidenceRuntimeWindow {
  return window as unknown as AdjutorixEvidenceRuntimeWindow;
}

async function adjutorixEvidenceWorkspace(): Promise<string> {
  const bridge = adjutorixEvidenceWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  const defaults = await bridge.defaults();
  return typeof defaults.workspace === "string" ? defaults.workspace : "";
}

function adjutorixEvidenceText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixEvidenceTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function installAdjutorixAiRunwayEvidenceRecorder(): Promise<void> {
  if (document.getElementById("adjutorix-ai-runway-evidence-recorder")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-evidence-recorder";
  panel.className = "adjutorix-ai-runway-evidence-recorder";
  panel.setAttribute("aria-label", "Adjutorix AI runway evidence recorder");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-runway-evidence-header";

  const title = document.createElement("strong");
  title.textContent = "Runway Evidence";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-runway-evidence-confirm";
  confirm.placeholder = "Type RECORD";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-runway-evidence-note";
  note.placeholder = "Operator note for this evidence object...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-runway-evidence-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Evidence";

  const recordButton = document.createElement("button");
  recordButton.type = "button";
  recordButton.textContent = "Record Evidence";

  const diffButton = document.createElement("button");
  diffButton.type = "button";
  diffButton.textContent = "Refresh Diff";

  actions.appendChild(previewButton);
  actions.appendChild(diffButton);
  actions.appendChild(recordButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-runway-evidence-output";
  output.textContent = "Evidence recorder mounted. Type RECORD before writing evidence.";

  let latestDiff = "";

  async function buildEvidenceObject(includeDiff: boolean): Promise<Record<string, unknown>> {
    const workspace = await adjutorixEvidenceWorkspace();
    const bridge = adjutorixEvidenceWindow().adjutorixWorkspaceOS;

    if (includeDiff && bridge?.gitDiff) {
      const diff = await bridge.gitDiff({ workspace });
      latestDiff = typeof diff === "string" ? diff : JSON.stringify(diff, null, 2);
    }

    return {
      schema: "adjutorix.ai_runway_evidence.v1",
      source: "adjutorix-ai-runway-evidence-recorder",
      recorded_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      ai_provider_panel: {
        output: adjutorixEvidenceText(".adjutorix-ai-output"),
      },
      patch_runway: {
        target_path: adjutorixEvidenceText(".adjutorix-ai-patch-path"),
        instruction: adjutorixEvidenceText(".adjutorix-ai-patch-instruction"),
        patch_output: adjutorixEvidenceText(".adjutorix-ai-patch-output"),
      },
      verify_runway: {
        commands: adjutorixEvidenceText(".adjutorix-ai-patch-verify-commands"),
        output: adjutorixEvidenceText(".adjutorix-ai-patch-verify-output"),
      },
      git_diff_snapshot: latestDiff,
    };
  }

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  diffButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixEvidenceWindow().adjutorixWorkspaceOS;

      if (!bridge?.gitDiff) {
        setOutput("Workspace OS git diff bridge unavailable.");
        return;
      }

      setBusy(diffButton, true);
      try {
        const workspace = await adjutorixEvidenceWorkspace();
        const diff = await bridge.gitDiff({ workspace });
        latestDiff = typeof diff === "string" ? diff : JSON.stringify(diff, null, 2);
        setOutput(latestDiff || "No diff returned.");
        console.log("ADJUTORIX_AI_RUNWAY_EVIDENCE_DIFF_READY", JSON.stringify({
          source: "adjutorix-ai-runway-evidence-recorder",
          workspace,
          bytes: latestDiff.length,
        }));
      } catch (error) {
        setOutput(`DIFF SNAPSHOT FAILED\n${String(error)}`);
      } finally {
        setBusy(diffButton, false);
      }
    })();
  });

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const evidence = await buildEvidenceObject(false);
        setOutput(JSON.stringify(evidence, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_EVIDENCE_PREVIEW_READY", JSON.stringify({
          source: "adjutorix-ai-runway-evidence-recorder",
        }));
      } catch (error) {
        setOutput(`EVIDENCE PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  recordButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixEvidenceWindow().adjutorixWorkspaceOS;

      if (!bridge?.writeText) {
        setOutput("Workspace OS write bridge unavailable.");
        return;
      }

      if (confirm.value.trim() !== "RECORD") {
        setOutput("Evidence write blocked. Type RECORD in the confirmation field.");
        return;
      }

      setBusy(recordButton, true);
      try {
        const evidence = await buildEvidenceObject(true);
        const workspace = typeof evidence.workspace === "string" ? evidence.workspace : "";
        const path = `.adjutorix-ai-runway/${adjutorixEvidenceTimestamp()}-evidence.json`;
        const content = JSON.stringify(evidence, null, 2) + "\n";

        await bridge.writeText({ workspace, path, content });

        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, path, bytes: content.length, evidence }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_EVIDENCE_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-evidence-recorder",
          path,
          bytes: content.length,
          workspace,
        }));
      } catch (error) {
        setOutput(`EVIDENCE RECORD FAILED\n${String(error)}`);
      } finally {
        setBusy(recordButton, false);
      }
    })();
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_EVIDENCE_RECORDER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-evidence-recorder",
    writes: ".adjutorix-ai-runway",
    requires: "manual-record-confirmation",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void installAdjutorixAiRunwayEvidenceRecorder();
  }, { once: true });
} else {
  void installAdjutorixAiRunwayEvidenceRecorder();
}


/**
 * ADJUTORIX_AI_WORKSPACE_CONTEXT_PACK_V1
 *
 * Real repo-context builder:
 * - scans workspace through adjutorixWorkspaceOS.scan
 * - reads selected files through adjutorixWorkspaceOS.readText
 * - searches workspace through adjutorixWorkspaceOS.searchText
 * - builds bounded JSON context packs
 * - injects context into AI assistant and patch runway prompts
 */

interface AdjutorixContextPackFileEntry {
  path?: string;
  relativePath?: string;
  size?: number;
  bytes?: number;
}

interface AdjutorixContextPackSearchMatch {
  path?: string;
  line?: number;
  text?: string;
  preview?: string;
}

interface AdjutorixContextPackWorkspaceBridge {
  defaults?: () => Promise<{ workspace?: string }>;
  scan?: (request?: unknown) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<{ content?: string; path?: string }>;
  searchText?: (request: { workspace?: string; query: string; limit?: number }) => Promise<unknown>;
}

interface AdjutorixContextPackRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixContextPackWorkspaceBridge;
}

function adjutorixContextPackWindow(): AdjutorixContextPackRuntimeWindow {
  return window as unknown as AdjutorixContextPackRuntimeWindow;
}

async function adjutorixContextPackWorkspace(): Promise<string> {
  const bridge = adjutorixContextPackWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixContextPackRecord(defaults);
    const workspace = record.workspace || record.root || record.cwd || record.path || record.workspacePath;

    if (typeof workspace === "string" && workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

/* ADJUTORIX_AI_CONTEXT_WORKSPACE_POLLING_FIX_V1 */


/* ADJUTORIX_AI_CONTEXT_SCAN_SIGNATURE_FIX_V1 */

async function adjutorixContextPackScanWorkspace(
  bridge: AdjutorixContextPackWorkspaceBridge,
  workspace: string,
): Promise<unknown> {
  const scan = bridge.scan;

  if (!scan) {
    throw new Error("Workspace OS scan bridge unavailable.");
  }

  const attempts: unknown[] = workspace ? [workspace, undefined] : [undefined];
  let lastError: unknown = new Error("Workspace scan did not run.");

  for (let round = 0; round < 32; round += 1) {
    for (const attempt of attempts) {
      try {
        const result = await scan(attempt);
        const fileCount = adjutorixMissionFileCountFromScan(result);

        if (fileCount > 300 || round === 31) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function adjutorixContextPackRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixContextPackArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixContextPackPath(entry: unknown): string {
  const record = adjutorixContextPackRecord(entry);
  const path = record.path || record.relativePath || record.file || record.name;
  return typeof path === "string" ? path : "";
}

function adjutorixContextPackFilesFromScan(value: unknown): string[] {
  const record = adjutorixContextPackRecord(value);
  const rawFiles = adjutorixContextPackArray(record.files || record.entries || record.items);

  return rawFiles
    .map(adjutorixContextPackPath)
    .filter(Boolean)
    .filter((path) => !path.includes("node_modules/"))
    .filter((path) => !path.includes("/dist/"))
    .filter((path) => !path.includes("/release/"))
    .slice(0, 400);
}

function adjutorixContextPackSearchMatches(value: unknown): Array<Record<string, unknown>> {
  const record = adjutorixContextPackRecord(value);
  const raw = adjutorixContextPackArray(record.matches || record.results || record.items);

  return raw
    .map(adjutorixContextPackRecord)
    .slice(0, 80);
}

function adjutorixContextPackSelectedPaths(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((path) => path.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function adjutorixContextPackClampText(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) {
    return value;
  }

  return `${value.slice(0, maxBytes)}\n\n/* ADJUTORIX_CONTEXT_TRUNCATED ${value.length - maxBytes} chars omitted */`;
}

function installAdjutorixAiWorkspaceContextPack(): void {
  if (document.getElementById("adjutorix-ai-workspace-context-pack")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-workspace-context-pack";
  panel.className = "adjutorix-ai-workspace-context-pack";
  panel.setAttribute("aria-label", "Adjutorix AI workspace context pack");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-context-header";

  const title = document.createElement("strong");
  title.textContent = "Workspace Context";

  const budget = document.createElement("input");
  budget.className = "adjutorix-ai-context-budget";
  budget.type = "number";
  budget.min = "1000";
  budget.max = "120000";
  budget.value = "24000";
  budget.title = "Max characters per context pack";

  header.appendChild(title);
  header.appendChild(budget);

  const paths = document.createElement("textarea");
  paths.className = "adjutorix-ai-context-paths";
  paths.placeholder = "File paths to include, one per line. Use Scan to discover.";
  paths.spellcheck = false;

  const query = document.createElement("input");
  query.className = "adjutorix-ai-context-query";
  query.placeholder = "Search query to include matches, e.g. ADJUTORIX_AI_PATCH";
  query.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-context-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan";

  const searchButton = document.createElement("button");
  searchButton.type = "button";
  searchButton.textContent = "Search";

  const buildButton = document.createElement("button");
  buildButton.type = "button";
  buildButton.textContent = "Build Pack";

  const injectAiButton = document.createElement("button");
  injectAiButton.type = "button";
  injectAiButton.textContent = "Inject AI";

  const injectPatchButton = document.createElement("button");
  injectPatchButton.type = "button";
  injectPatchButton.textContent = "Inject Patch";

  actions.appendChild(scanButton);
  actions.appendChild(searchButton);
  actions.appendChild(buildButton);
  actions.appendChild(injectAiButton);
  actions.appendChild(injectPatchButton);

  const output = document.createElement("textarea");
  output.className = "adjutorix-ai-context-output";
  output.placeholder = "Context pack JSON appears here.";
  output.spellcheck = false;

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  function setOutput(value: string): void {
    output.value = value;
  }

  async function buildPack(includeSearch: boolean): Promise<Record<string, unknown>> {
    const bridge = adjutorixContextPackWindow().adjutorixWorkspaceOS;

    if (!bridge?.readText) {
      throw new Error("Workspace OS read bridge unavailable.");
    }

    const workspace = await adjutorixContextPackWorkspace();
    const maxChars = Number.parseInt(budget.value, 10) || 24000;
    const selected = adjutorixContextPackSelectedPaths(paths.value);
    const perFileBudget = Math.max(1600, Math.floor(maxChars / Math.max(1, selected.length || 1)));
    const files: Array<{ path: string; content: string; chars: number }> = [];

    for (const path of selected) {
      const result = await bridge.readText({ workspace, path });
      const content = adjutorixContextPackClampText(String(result.content || ""), perFileBudget);
      files.push({ path, content, chars: content.length });
    }

    let search: unknown[] = [];

    if (includeSearch && bridge.searchText && query.value.trim()) {
      const result = await bridge.searchText({ workspace, query: query.value.trim(), limit: 80 });
      search = adjutorixContextPackSearchMatches(result);
    }

    const pack = {
      schema: "adjutorix.ai_workspace_context_pack.v1",
      source: "adjutorix-ai-workspace-context-pack",
      created_at: new Date().toISOString(),
      workspace,
      budget: {
        max_chars: maxChars,
        per_file_chars: perFileBudget,
      },
      selected_paths: selected,
      search_query: query.value.trim(),
      files,
      search,
    };

    return pack;
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixContextPackWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      try {
        const workspace = await adjutorixContextPackWorkspace();
        const result = await adjutorixContextPackScanWorkspace(bridge, workspace);
        const found = adjutorixContextPackFilesFromScan(result);

        setOutput(JSON.stringify({ ok: true, workspace, count: found.length, files: found }, null, 2));
        console.log("ADJUTORIX_AI_CONTEXT_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-workspace-context-pack",
          workspace,
          files: found.length,
        }));
      } catch (error) {
        setOutput(`CONTEXT SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  searchButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixContextPackWindow().adjutorixWorkspaceOS;

      if (!bridge?.searchText) {
        setOutput("Workspace OS search bridge unavailable.");
        return;
      }

      if (!query.value.trim()) {
        setOutput("Enter a search query.");
        return;
      }

      setBusy(searchButton, true);
      try {
        const workspace = await adjutorixContextPackWorkspace();
        const result = await bridge.searchText({ workspace, query: query.value.trim(), limit: 80 });
        const matches = adjutorixContextPackSearchMatches(result);

        setOutput(JSON.stringify({ ok: true, workspace, query: query.value.trim(), matches }, null, 2));
        console.log("ADJUTORIX_AI_CONTEXT_SEARCH_READY", JSON.stringify({
          source: "adjutorix-ai-workspace-context-pack",
          workspace,
          matches: matches.length,
        }));
      } catch (error) {
        setOutput(`CONTEXT SEARCH FAILED\n${String(error)}`);
      } finally {
        setBusy(searchButton, false);
      }
    })();
  });

  buildButton.addEventListener("click", () => {
    void (async () => {
      setBusy(buildButton, true);
      try {
        const pack = await buildPack(true);
        setOutput(JSON.stringify(pack, null, 2));
        console.log("ADJUTORIX_AI_CONTEXT_PACK_READY", JSON.stringify({
          source: "adjutorix-ai-workspace-context-pack",
          files: Array.isArray(pack.files) ? pack.files.length : 0,
          search: Array.isArray(pack.search) ? pack.search.length : 0,
        }));
      } catch (error) {
        setOutput(`CONTEXT PACK FAILED\n${String(error)}`);
      } finally {
        setBusy(buildButton, false);
      }
    })();
  });

  injectAiButton.addEventListener("click", () => {
    const prompt = document.querySelector<HTMLTextAreaElement>(".adjutorix-ai-prompt");

    if (!prompt) {
      setOutput("AI prompt field not found.");
      return;
    }

    prompt.value = `${prompt.value.trim()}\n\nADJUTORIX WORKSPACE CONTEXT PACK:\n${output.value}`.trim();
    console.log("ADJUTORIX_AI_CONTEXT_INJECTED", JSON.stringify({
      source: "adjutorix-ai-workspace-context-pack",
      target: "ai-assistant",
      bytes: output.value.length,
    }));
  });

  injectPatchButton.addEventListener("click", () => {
    const instruction = document.querySelector<HTMLTextAreaElement>(".adjutorix-ai-patch-instruction");

    if (!instruction) {
      setOutput("Patch runway instruction field not found.");
      return;
    }

    instruction.value = `${instruction.value.trim()}\n\nADJUTORIX WORKSPACE CONTEXT PACK:\n${output.value}`.trim();
    console.log("ADJUTORIX_AI_CONTEXT_INJECTED", JSON.stringify({
      source: "adjutorix-ai-workspace-context-pack",
      target: "patch-runway",
      bytes: output.value.length,
    }));
  });

  panel.appendChild(header);
  panel.appendChild(paths);
  panel.appendChild(query);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_WORKSPACE_CONTEXT_PACK_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-workspace-context-pack",
    bridges: ["scan", "readText", "searchText"],
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiWorkspaceContextPack, { once: true });
} else {
  installAdjutorixAiWorkspaceContextPack();
}


/**
 * ADJUTORIX_AI_RUNWAY_MISSION_CONTROL_V1
 *
 * Unified AI runway control surface:
 * - detects mounted workspace OS, provider bridge, context pack, patch runway, verify runway, evidence recorder
 * - checks provider status through adjutorixAI.status
 * - checks workspace defaults through adjutorixWorkspaceOS.defaults
 * - emits one live readiness object for the whole installed product chain
 * - no fake execution; this is a state/control spine over the already-real bridges
 */

interface AdjutorixMissionProviderRecord {
  configured?: boolean;
  available?: boolean;
  provider?: string;
  model?: string;
  endpoint?: string;
  reason?: string;
}

interface AdjutorixMissionAiBridge {
  status?: () => Promise<{
    ok: boolean;
    providers: Record<string, AdjutorixMissionProviderRecord>;
  }>;
}

interface AdjutorixMissionWorkspaceBridge {
  defaults?: () => Promise<{ workspace?: string }>;
  scan?: (request?: unknown) => Promise<unknown>;
  gitDiff?: (request: { workspace?: string }) => Promise<unknown>;
}

interface AdjutorixMissionRuntimeWindow {
  adjutorixAI?: AdjutorixMissionAiBridge;
  adjutorixWorkspaceOS?: AdjutorixMissionWorkspaceBridge;
}

function adjutorixMissionWindow(): AdjutorixMissionRuntimeWindow {
  return window as unknown as AdjutorixMissionRuntimeWindow;
}

function adjutorixMissionMounted(selector: string): boolean {
  return Boolean(document.querySelector(selector));
}

function adjutorixMissionText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}


/* ADJUTORIX_AI_MISSION_WORKSPACE_READINESS_V1 */

function adjutorixMissionRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixMissionString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixMissionNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function adjutorixMissionWorkspaceFromScan(scanResult: unknown): string {
  const record = adjutorixMissionRecord(scanResult);
  return adjutorixMissionString(record.workspace || record.root || record.cwd);
}


/* ADJUTORIX_AI_MISSION_WORKSPACE_POLLING_FIX_V1 */

async function adjutorixMissionResolveWorkspace(
  bridge: AdjutorixMissionWorkspaceBridge | undefined,
): Promise<string> {
  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    try {
      const defaults = await bridge.defaults();
      const record = adjutorixMissionRecord(defaults);
      const workspace = adjutorixMissionString(
        record.workspace || record.root || record.cwd || record.path || record.workspacePath,
      );

      if (workspace) {
        return workspace;
      }
    } catch {
      // keep polling until workspace OS finishes mounting
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixMissionFileCountFromScan(scanResult: unknown): number {
  const record = adjutorixMissionRecord(scanResult);
  const explicit = adjutorixMissionNumber(record.count || record.fileCount || record.filesCount);

  if (explicit > 0) {
    return explicit;
  }

  const files = record.files || record.entries || record.items;

  if (Array.isArray(files)) {
    return files.length;
  }

  return 0;
}


/* ADJUTORIX_AI_MISSION_SCAN_SIGNATURE_FIX_V1 */

async function adjutorixMissionScanWorkspace(
  bridge: AdjutorixMissionWorkspaceBridge,
  workspace: string,
): Promise<unknown> {
  const scan = bridge.scan;

  if (!scan) {
    throw new Error("Workspace OS scan bridge unavailable.");
  }

  if (!workspace) {
    throw new Error("workspace_path_required");
  }

  let lastError: unknown = new Error("Workspace scan did not run.");

  for (let round = 0; round < 40; round += 1) {
    try {
      const result = await scan(workspace);
      const fileCount = adjutorixMissionFileCountFromScan(result);

      if (fileCount > 300 || round === 39) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function installAdjutorixAiRunwayMissionControl(): Promise<void> {
  if (document.getElementById("adjutorix-ai-runway-mission-control")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-mission-control";
  panel.className = "adjutorix-ai-runway-mission-control";
  panel.setAttribute("aria-label", "Adjutorix AI runway mission control");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-mission-header";

  const title = document.createElement("strong");
  title.textContent = "AI Mission Control";

  const stateBadge = document.createElement("span");
  stateBadge.className = "adjutorix-ai-mission-state";
  stateBadge.textContent = "checking";

  header.appendChild(title);
  header.appendChild(stateBadge);

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-mission-actions";

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.textContent = "Refresh";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Snapshot";

  const diffButton = document.createElement("button");
  diffButton.type = "button";
  diffButton.textContent = "Diff Snapshot";

  actions.appendChild(refreshButton);
  actions.appendChild(diffButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-mission-output";
  output.textContent = "Mission control mounted.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildSnapshot(includeDiff: boolean): Promise<Record<string, unknown>> {
    const runtime = adjutorixMissionWindow();

    let workspaceValue = "";
    let workspaceFileCount = 0;
    let workspaceScanOk = false;

    workspaceValue = await adjutorixMissionResolveWorkspace(runtime.adjutorixWorkspaceOS);

    if (runtime.adjutorixWorkspaceOS?.scan && workspaceValue) {
      const scanResult = await adjutorixMissionScanWorkspace(runtime.adjutorixWorkspaceOS, workspaceValue);
      const scanWorkspace = adjutorixMissionWorkspaceFromScan(scanResult);
      workspaceFileCount = adjutorixMissionFileCountFromScan(scanResult);
      workspaceScanOk = workspaceFileCount > 300;

      if (!workspaceValue && scanWorkspace) {
        workspaceValue = scanWorkspace;
      }
    }

    const providers = runtime.adjutorixAI?.status
      ? await runtime.adjutorixAI.status()
      : { ok: false, providers: {} };

    let diffSnapshot = "";

    if (includeDiff && runtime.adjutorixWorkspaceOS?.gitDiff) {
      const diff = await runtime.adjutorixWorkspaceOS.gitDiff({ workspace: workspaceValue });
      diffSnapshot = typeof diff === "string" ? diff : JSON.stringify(diff, null, 2);
    }

    const surfaces = {
      workspace_os: Boolean(runtime.adjutorixWorkspaceOS),
      ai_provider_bridge: Boolean(runtime.adjutorixAI),
      ai_assistant: adjutorixMissionMounted("#adjutorix-ai-assistant"),
      patch_runway: adjutorixMissionMounted("#adjutorix-ai-patch-runway"),
      verify_runway: adjutorixMissionMounted("#adjutorix-ai-patch-verify-runway"),
      evidence_recorder: adjutorixMissionMounted("#adjutorix-ai-runway-evidence-recorder"),
      context_pack: adjutorixMissionMounted("#adjutorix-ai-workspace-context-pack"),
    };

    const surfacesReady = Object.values(surfaces).every(Boolean);
    const workspaceReady = Boolean(workspaceValue) && workspaceScanOk;
    const ready = surfacesReady && workspaceReady;

    const patchPlanBytes = adjutorixMissionText(".adjutorix-ai-patch-output").length;
    const contextBytes = adjutorixMissionText(".adjutorix-ai-context-output").length;
    const verifyBytes = adjutorixMissionText(".adjutorix-ai-patch-verify-output").length;

    return {
      schema: "adjutorix.ai_runway_mission_control_snapshot.v1",
      source: "adjutorix-ai-runway-mission-control",
      readiness_source: "adjutorix-ai-mission-workspace-readiness",
      created_at: new Date().toISOString(),
      ready,
      surfaces_ready: surfacesReady,
      workspace_ready: workspaceReady,
      workspace: workspaceValue,
      workspace_file_count: workspaceFileCount,
      surfaces,
      providers,
      live_payload_sizes: {
        context_pack_chars: contextBytes,
        patch_plan_chars: patchPlanBytes,
        verify_output_chars: verifyBytes,
      },
      diff_snapshot: diffSnapshot,
    };
  }

  async function refresh(includeDiff: boolean): Promise<void> {
    const snapshot = await buildSnapshot(includeDiff);
    stateBadge.textContent = snapshot.ready ? "ready" : "incomplete";
    panel.setAttribute("data-ready", snapshot.ready ? "true" : "false");
    setOutput(JSON.stringify(snapshot, null, 2));
    console.log("ADJUTORIX_AI_RUNWAY_MISSION_CONTROL_SNAPSHOT", JSON.stringify({
      source: "adjutorix-ai-runway-mission-control",
      ready: snapshot.ready,
      workspace_ready: snapshot.workspace_ready,
      surfaces_ready: snapshot.surfaces_ready,
      workspace: snapshot.workspace,
      workspace_file_count: snapshot.workspace_file_count,
      readiness_source: snapshot.readiness_source,
    }));
  }

  refreshButton.addEventListener("click", () => {
    void (async () => {
      setBusy(refreshButton, true);
      try {
        await refresh(false);
      } catch (error) {
        stateBadge.textContent = "error";
        setOutput(`MISSION SNAPSHOT FAILED\n${String(error)}`);
      } finally {
        setBusy(refreshButton, false);
      }
    })();
  });

  diffButton.addEventListener("click", () => {
    void (async () => {
      setBusy(diffButton, true);
      try {
        await refresh(true);
      } catch (error) {
        stateBadge.textContent = "error";
        setOutput(`MISSION DIFF SNAPSHOT FAILED\n${String(error)}`);
      } finally {
        setBusy(diffButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_MISSION_CONTROL_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-mission-control",
    surfaces: [
      "workspace-os",
      "ai-provider-bridge",
      "context-pack",
      "patch-runway",
      "verify-runway",
      "evidence-recorder",
    ],
  }));

  await refresh(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void installAdjutorixAiRunwayMissionControl();
  }, { once: true });
} else {
  void installAdjutorixAiRunwayMissionControl();
}


/* ADJUTORIX_AI_SCAN_NO_OBJECT_ATTEMPTS_V1 */


/**
 * ADJUTORIX_AI_RUNWAY_MISSION_LOCK_V1
 *
 * Manual mission lock recorder:
 * - requires LOCK confirmation
 * - resolves workspace through workspace OS
 * - captures mission-control snapshot text
 * - captures provider status
 * - captures git diff snapshot
 * - can run default verification commands
 * - writes durable JSON lock object to .adjutorix-ai-runway/
 */

interface AdjutorixMissionLockRunResult {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  code?: number;
  ok?: boolean;
  elapsedMs?: number;
}

interface AdjutorixMissionLockWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  gitDiff?: (request: { workspace?: string }) => Promise<unknown>;
  run?: (request: { workspace?: string; command: string }) => Promise<AdjutorixMissionLockRunResult>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixMissionLockAiBridge {
  status?: () => Promise<unknown>;
}

interface AdjutorixMissionLockRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixMissionLockWorkspaceBridge;
  adjutorixAI?: AdjutorixMissionLockAiBridge;
}

function adjutorixMissionLockWindow(): AdjutorixMissionLockRuntimeWindow {
  return window as unknown as AdjutorixMissionLockRuntimeWindow;
}

function adjutorixMissionLockRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixMissionLockText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixMissionLockTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixMissionLockWorkspace(): Promise<string> {
  const bridge = adjutorixMissionLockWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixMissionLockRecord(defaults);
    const workspace = record.workspace || record.root || record.cwd || record.path || record.workspacePath;

    if (typeof workspace === "string" && workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function installAdjutorixAiRunwayMissionLock(): void {
  if (document.getElementById("adjutorix-ai-runway-mission-lock")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-mission-lock";
  panel.className = "adjutorix-ai-runway-mission-lock";
  panel.setAttribute("aria-label", "Adjutorix AI runway mission lock");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-mission-lock-header";

  const title = document.createElement("strong");
  title.textContent = "Mission Lock";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-mission-lock-confirm";
  confirm.placeholder = "Type LOCK";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-mission-lock-note";
  note.placeholder = "Operator lock note...";
  note.spellcheck = false;

  const commands = document.createElement("textarea");
  commands.className = "adjutorix-ai-mission-lock-commands";
  commands.spellcheck = false;
  commands.value = [
    "pnpm --filter @adjutorix/app run build:ts",
    "pnpm --filter @adjutorix/app run lint",
    "bash scripts/check.sh",
  ].join("\n");

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-mission-lock-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Lock";

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.textContent = "Run + Lock";

  const lockButton = document.createElement("button");
  lockButton.type = "button";
  lockButton.textContent = "Lock Only";

  actions.appendChild(previewButton);
  actions.appendChild(runButton);
  actions.appendChild(lockButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-mission-lock-output";
  output.textContent = "Mission lock mounted. Type LOCK before writing a lock object.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildLockObject(runChecks: boolean): Promise<Record<string, unknown>> {
    const runtime = adjutorixMissionLockWindow();
    const workspace = await adjutorixMissionLockWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const providers = runtime.adjutorixAI?.status ? await runtime.adjutorixAI.status() : {};
    const diff = runtime.adjutorixWorkspaceOS?.gitDiff
      ? await runtime.adjutorixWorkspaceOS.gitDiff({ workspace })
      : "";

    const plannedCommands = commands.value
      .split("\n")
      .map((command) => command.trim())
      .filter(Boolean);

    const commandResults: Array<{ command: string; result: AdjutorixMissionLockRunResult | { error: string } }> = [];

    if (runChecks) {
      if (!runtime.adjutorixWorkspaceOS?.run) {
        throw new Error("workspace_run_bridge_unavailable");
      }

      for (const command of plannedCommands) {
        setOutput(JSON.stringify({
          running: command,
          completed: commandResults.length,
          total: plannedCommands.length,
        }, null, 2));

        try {
          const result = await runtime.adjutorixWorkspaceOS.run({ workspace, command });
          commandResults.push({ command, result });
        } catch (error) {
          commandResults.push({ command, result: { error: String(error) } });
          break;
        }
      }
    }

    return {
      schema: "adjutorix.ai_runway_mission_lock.v1",
      source: "adjutorix-ai-runway-mission-lock",
      locked_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      mission_control_snapshot_text: adjutorixMissionLockText(".adjutorix-ai-mission-output"),
      context_pack_text: adjutorixMissionLockText(".adjutorix-ai-context-output"),
      patch_plan_text: adjutorixMissionLockText(".adjutorix-ai-patch-output"),
      verify_output_text: adjutorixMissionLockText(".adjutorix-ai-patch-verify-output"),
      providers,
      git_diff_snapshot: typeof diff === "string" ? diff : JSON.stringify(diff, null, 2),
      planned_commands: plannedCommands,
      command_results: commandResults,
      ran_checks: runChecks,
    };
  }

  async function writeLockObject(lock: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixMissionLockWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = typeof lock.workspace === "string" ? lock.workspace : "";
    const path = `.adjutorix-ai-runway/${adjutorixMissionLockTimestamp()}-mission-lock.json`;
    const content = JSON.stringify(lock, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const lock = await buildLockObject(false);
        setOutput(JSON.stringify(lock, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_MISSION_LOCK_PREVIEW_READY", JSON.stringify({
          source: "adjutorix-ai-runway-mission-lock",
          workspace: lock.workspace,
        }));
      } catch (error) {
        setOutput(`MISSION LOCK PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  lockButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "LOCK") {
        setOutput("Mission lock blocked. Type LOCK in the confirmation field.");
        return;
      }

      setBusy(lockButton, true);
      try {
        const lock = await buildLockObject(false);
        const written = await writeLockObject(lock);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, lock }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_MISSION_LOCK_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-mission-lock",
          path: written.path,
          bytes: written.bytes,
          workspace: lock.workspace,
          ran_checks: false,
        }));
      } catch (error) {
        setOutput(`MISSION LOCK FAILED\n${String(error)}`);
      } finally {
        setBusy(lockButton, false);
      }
    })();
  });

  runButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "LOCK") {
        setOutput("Mission run+lock blocked. Type LOCK in the confirmation field.");
        return;
      }

      setBusy(runButton, true);
      try {
        const lock = await buildLockObject(true);
        const written = await writeLockObject(lock);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, lock }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_MISSION_LOCK_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-mission-lock",
          path: written.path,
          bytes: written.bytes,
          workspace: lock.workspace,
          ran_checks: true,
        }));
      } catch (error) {
        setOutput(`MISSION RUN+LOCK FAILED\n${String(error)}`);
      } finally {
        setBusy(runButton, false);
      }
    })();
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(commands);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_MISSION_LOCK_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-mission-lock",
    writes: ".adjutorix-ai-runway",
    requires: "manual-lock-confirmation",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayMissionLock, { once: true });
} else {
  installAdjutorixAiRunwayMissionLock();
}


/**
 * ADJUTORIX_AI_RUNWAY_LOCK_VERIFIER_V1
 *
 * Mission lock verifier:
 * - scans workspace for .adjutorix-ai-runway/*mission-lock*.json
 * - reads selected lock JSON through workspace OS
 * - validates schema/source/workspace/required evidence fields
 * - computes SHA-256 content hash
 * - emits a local verification report
 */

interface AdjutorixLockVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixLockVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixLockVerifierWorkspaceBridge;
}

interface AdjutorixLockVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixLockVerifierWindow(): AdjutorixLockVerifierRuntimeWindow {
  return window as unknown as AdjutorixLockVerifierRuntimeWindow;
}

function adjutorixLockVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixLockVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixLockVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixLockVerifierPath(value: unknown): string {
  const record = adjutorixLockVerifierRecord(value);
  return adjutorixLockVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixLockVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixLockVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixLockVerifierRecord(defaults);
    const workspace = adjutorixLockVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixLockVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixLockVerifierRecord(scanResult);
  const files = adjutorixLockVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixLockVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("mission-lock"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixLockVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixLockVerifierValidate(lock: Record<string, unknown>): AdjutorixLockVerifierValidation {
  const failures: string[] = [];

  if (lock.schema !== "adjutorix.ai_runway_mission_lock.v1") {
    failures.push("schema_mismatch");
  }

  if (lock.source !== "adjutorix-ai-runway-mission-lock") {
    failures.push("source_mismatch");
  }

  if (!adjutorixLockVerifierString(lock.locked_at)) {
    failures.push("locked_at_missing");
  }

  if (!adjutorixLockVerifierString(lock.workspace)) {
    failures.push("workspace_missing");
  }

  if (!adjutorixLockVerifierString(lock.mission_control_snapshot_text)) {
    failures.push("mission_control_snapshot_text_missing");
  }

  if (!adjutorixLockVerifierString(lock.git_diff_snapshot)) {
    failures.push("git_diff_snapshot_missing");
  }

  if (!Array.isArray(lock.planned_commands)) {
    failures.push("planned_commands_not_array");
  }

  if (!Array.isArray(lock.command_results)) {
    failures.push("command_results_not_array");
  }

  if (typeof lock.ran_checks !== "boolean") {
    failures.push("ran_checks_not_boolean");
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function installAdjutorixAiRunwayLockVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-lock-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-lock-verifier";
  panel.className = "adjutorix-ai-runway-lock-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway lock verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-lock-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Lock Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-lock-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-lock-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-lock-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Locks";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Selected";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-lock-verifier-output";
  output.textContent = "Lock verifier mounted. Scan for mission locks.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixLockVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixLockVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const locks = adjutorixLockVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const lockPath of locks) {
          const option = document.createElement("option");
          option.value = lockPath;
          option.textContent = lockPath;
          select.appendChild(option);
        }

        setState(locks.length ? "locks found" : "no locks");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          lock_count: locks.length,
          locks,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_LOCK_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-lock-verifier",
          workspace,
          lock_count: locks.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`LOCK SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixLockVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No lock selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixLockVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixLockVerifierRecord(readResult);
        const content = adjutorixLockVerifierString(readRecord.content || readResult);
        const parsed = adjutorixLockVerifierRecord(JSON.parse(content));
        const validation = adjutorixLockVerifierValidate(parsed);
        const sha256 = await adjutorixLockVerifierSha256(content);

        const report = {
          schema: "adjutorix.ai_runway_lock_verification_report.v1",
          source: "adjutorix-ai-runway-lock-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          sha256,
          validation,
          lock: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_LOCK_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-lock-verifier",
          workspace,
          path: select.value,
          sha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`LOCK VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_LOCK_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-lock-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_mission_lock.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayLockVerifier, { once: true });
} else {
  installAdjutorixAiRunwayLockVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_VERIFICATION_SEAL_V1
 *
 * Manual verification seal recorder:
 * - reads lock verifier report from the verifier panel
 * - requires SEAL confirmation
 * - validates report schema/source/workspace/sha256/path fields
 * - records a durable seal JSON file into .adjutorix-ai-runway/
 */

interface AdjutorixVerificationSealWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixVerificationSealRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixVerificationSealWorkspaceBridge;
}

function adjutorixVerificationSealWindow(): AdjutorixVerificationSealRuntimeWindow {
  return window as unknown as AdjutorixVerificationSealRuntimeWindow;
}

function adjutorixVerificationSealRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixVerificationSealString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixVerificationSealText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixVerificationSealTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixVerificationSealWorkspace(): Promise<string> {
  const bridge = adjutorixVerificationSealWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixVerificationSealRecord(defaults);
    const workspace = adjutorixVerificationSealString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixVerificationSealSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixVerificationSealParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("verification_report_empty");
  }

  const parsed = adjutorixVerificationSealRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_lock_verification_report.v1") {
    throw new Error("verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-lock-verifier") {
    throw new Error("verification_report_source_mismatch");
  }

  if (!adjutorixVerificationSealString(parsed.workspace)) {
    throw new Error("verification_report_workspace_missing");
  }

  if (!adjutorixVerificationSealString(parsed.path)) {
    throw new Error("verification_report_path_missing");
  }

  if (!adjutorixVerificationSealString(parsed.sha256)) {
    throw new Error("verification_report_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayVerificationSeal(): void {
  if (document.getElementById("adjutorix-ai-runway-verification-seal")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-verification-seal";
  panel.className = "adjutorix-ai-runway-verification-seal";
  panel.setAttribute("aria-label", "Adjutorix AI runway verification seal");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-verification-seal-header";

  const title = document.createElement("strong");
  title.textContent = "Verification Seal";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-verification-seal-confirm";
  confirm.placeholder = "Type SEAL";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-verification-seal-note";
  note.placeholder = "Operator seal note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-verification-seal-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Seal";

  const sealButton = document.createElement("button");
  sealButton.type = "button";
  sealButton.textContent = "Seal Report";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Seal";

  actions.appendChild(previewButton);
  actions.appendChild(sealButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-verification-seal-output";
  output.textContent = "Verification seal mounted. Verify a mission lock first, then type SEAL.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildSeal(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixVerificationSealWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const reportText = adjutorixVerificationSealText(".adjutorix-ai-lock-verifier-output");
    const report = adjutorixVerificationSealParseReport(reportText);
    const reportSha256 = await adjutorixVerificationSealSha256(reportText);
    const missionSnapshotText = adjutorixVerificationSealText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixVerificationSealSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_verification_seal.v1",
      source: "adjutorix-ai-runway-verification-seal",
      sealed_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      verification_report_sha256: reportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      verification_report: report,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeSeal(seal: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixVerificationSealWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixVerificationSealString(seal.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixVerificationSealTimestamp()}-verification-seal.json`;
    const content = JSON.stringify(seal, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const seal = await buildSeal();
        setOutput(JSON.stringify(seal, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_VERIFICATION_SEAL_PREVIEW_READY", JSON.stringify({
          source: "adjutorix-ai-runway-verification-seal",
          workspace: seal.workspace,
        }));
      } catch (error) {
        setOutput(`VERIFICATION SEAL PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  sealButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "SEAL") {
        setOutput("Verification seal blocked. Type SEAL in the confirmation field.");
        return;
      }

      setBusy(sealButton, true);
      try {
        const seal = await buildSeal();
        const written = await writeSeal(seal);

        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, seal }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_VERIFICATION_SEAL_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-verification-seal",
          workspace: seal.workspace,
          path: written.path,
          bytes: written.bytes,
          seals: "adjutorix.ai_runway_lock_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`VERIFICATION SEAL FAILED\n${String(error)}`);
      } finally {
        setBusy(sealButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_VERIFICATION_SEAL_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-verification-seal",
    writes: ".adjutorix-ai-runway",
    requires: "manual-seal-confirmation",
    seals: "adjutorix.ai_runway_lock_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayVerificationSeal, { once: true });
} else {
  installAdjutorixAiRunwayVerificationSeal();
}


/**
 * ADJUTORIX_AI_RUNWAY_SEAL_VERIFIER_V1
 *
 * Verification seal verifier:
 * - scans .adjutorix-ai-runway for verification-seal JSON files
 * - reads selected seal files through workspace OS
 * - validates seal schema/source/workspace/hash/report fields
 * - computes SHA-256 for the seal file content
 * - emits a durable local verification report in the panel
 */

interface AdjutorixSealVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixSealVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixSealVerifierWorkspaceBridge;
}

interface AdjutorixSealVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixSealVerifierWindow(): AdjutorixSealVerifierRuntimeWindow {
  return window as unknown as AdjutorixSealVerifierRuntimeWindow;
}

function adjutorixSealVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixSealVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixSealVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixSealVerifierPath(value: unknown): string {
  const record = adjutorixSealVerifierRecord(value);
  return adjutorixSealVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixSealVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixSealVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixSealVerifierRecord(defaults);
    const workspace = adjutorixSealVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixSealVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixSealVerifierRecord(scanResult);
  const files = adjutorixSealVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixSealVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("verification-seal"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixSealVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixSealVerifierValidate(seal: Record<string, unknown>): AdjutorixSealVerifierValidation {
  const failures: string[] = [];

  if (seal.schema !== "adjutorix.ai_runway_verification_seal.v1") {
    failures.push("schema_mismatch");
  }

  if (seal.source !== "adjutorix-ai-runway-verification-seal") {
    failures.push("source_mismatch");
  }

  if (!adjutorixSealVerifierString(seal.sealed_at)) {
    failures.push("sealed_at_missing");
  }

  if (!adjutorixSealVerifierString(seal.workspace)) {
    failures.push("workspace_missing");
  }

  if (!adjutorixSealVerifierString(seal.verification_report_sha256)) {
    failures.push("verification_report_sha256_missing");
  }

  if (!adjutorixSealVerifierString(seal.mission_snapshot_sha256)) {
    failures.push("mission_snapshot_sha256_missing");
  }

  if (!adjutorixSealVerifierString(seal.mission_control_snapshot_text)) {
    failures.push("mission_control_snapshot_text_missing");
  }

  const report = adjutorixSealVerifierRecord(seal.verification_report);

  if (report.schema !== "adjutorix.ai_runway_lock_verification_report.v1") {
    failures.push("verification_report_schema_mismatch");
  }

  if (report.source !== "adjutorix-ai-runway-lock-verifier") {
    failures.push("verification_report_source_mismatch");
  }

  if (!adjutorixSealVerifierString(report.path)) {
    failures.push("verification_report_path_missing");
  }

  if (!adjutorixSealVerifierString(report.sha256)) {
    failures.push("verification_report_lock_sha256_missing");
  }

  const validation = adjutorixSealVerifierRecord(report.validation);

  if (validation.ok !== true) {
    failures.push("verification_report_not_ok");
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function installAdjutorixAiRunwaySealVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-seal-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-seal-verifier";
  panel.className = "adjutorix-ai-runway-seal-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway seal verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-seal-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Seal Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-seal-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-seal-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-seal-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Seals";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Seal";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-seal-verifier-output";
  output.textContent = "Seal verifier mounted. Scan for verification seals.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixSealVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixSealVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const seals = adjutorixSealVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const sealPath of seals) {
          const option = document.createElement("option");
          option.value = sealPath;
          option.textContent = sealPath;
          select.appendChild(option);
        }

        setState(seals.length ? "seals found" : "no seals");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          seal_count: seals.length,
          seals,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_SEAL_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-seal-verifier",
          workspace,
          seal_count: seals.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`SEAL SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixSealVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No seal selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixSealVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixSealVerifierRecord(readResult);
        const content = adjutorixSealVerifierString(readRecord.content || readResult);
        const parsed = adjutorixSealVerifierRecord(JSON.parse(content));
        const validation = adjutorixSealVerifierValidate(parsed);
        const sha256 = await adjutorixSealVerifierSha256(content);

        const report = {
          schema: "adjutorix.ai_runway_seal_verification_report.v1",
          source: "adjutorix-ai-runway-seal-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          seal_sha256: sha256,
          validation,
          seal: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_SEAL_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-seal-verifier",
          workspace,
          path: select.value,
          seal_sha256: sha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`SEAL VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_SEAL_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-seal-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_verification_seal.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwaySealVerifier, { once: true });
} else {
  installAdjutorixAiRunwaySealVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_V1
 *
 * AI runway artifact index:
 * - scans .adjutorix-ai-runway JSON artifacts
 * - reads each artifact through workspace OS
 * - extracts schema/source/path/size/hash/status
 * - groups artifacts by schema
 * - manually writes a durable index JSON after INDEX confirmation
 */

interface AdjutorixArtifactIndexWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixArtifactIndexRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixArtifactIndexWorkspaceBridge;
}

function adjutorixArtifactIndexWindow(): AdjutorixArtifactIndexRuntimeWindow {
  return window as unknown as AdjutorixArtifactIndexRuntimeWindow;
}

function adjutorixArtifactIndexRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixArtifactIndexArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixArtifactIndexString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixArtifactIndexPath(value: unknown): string {
  const record = adjutorixArtifactIndexRecord(value);
  return adjutorixArtifactIndexString(record.path || record.relativePath || record.file || record.name);
}

function adjutorixArtifactIndexTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixArtifactIndexWorkspace(): Promise<string> {
  const bridge = adjutorixArtifactIndexWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixArtifactIndexRecord(defaults);
    const workspace = adjutorixArtifactIndexString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixArtifactIndexFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixArtifactIndexRecord(scanResult);
  const files = adjutorixArtifactIndexArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixArtifactIndexPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixArtifactIndexSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function adjutorixArtifactIndexBuild(): Promise<Record<string, unknown>> {
  const bridge = adjutorixArtifactIndexWindow().adjutorixWorkspaceOS;

  if (!bridge?.scan || !bridge.readText) {
    throw new Error("workspace_scan_or_read_bridge_unavailable");
  }

  const workspace = await adjutorixArtifactIndexWorkspace();

  if (!workspace) {
    throw new Error("workspace_not_resolved");
  }

  const scanResult = await bridge.scan(workspace);
  const paths = adjutorixArtifactIndexFilesFromScan(scanResult);
  const artifacts: Array<Record<string, unknown>> = [];
  const countsBySchema: Record<string, number> = {};

  for (const path of paths) {
    const readResult = await bridge.readText({ workspace, path });
    const readRecord = adjutorixArtifactIndexRecord(readResult);
    const content = adjutorixArtifactIndexString(readRecord.content || readResult);
    const sha256 = await adjutorixArtifactIndexSha256(content);

    let parsed: Record<string, unknown> = {};
    let parseOk = false;
    let parseError = "";

    try {
      parsed = adjutorixArtifactIndexRecord(JSON.parse(content));
      parseOk = true;
    } catch (error) {
      parseError = String(error);
    }

    const schema = adjutorixArtifactIndexString(parsed.schema || "unknown");
    const source = adjutorixArtifactIndexString(parsed.source || "unknown");

    countsBySchema[schema] = (countsBySchema[schema] || 0) + 1;

    artifacts.push({
      path,
      bytes: content.length,
      sha256,
      parse_ok: parseOk,
      parse_error: parseError,
      schema,
      source,
      workspace: adjutorixArtifactIndexString(parsed.workspace),
      created_at: adjutorixArtifactIndexString(
        parsed.created_at || parsed.recorded_at || parsed.locked_at || parsed.sealed_at || parsed.verified_at,
      ),
    });
  }

  return {
    schema: "adjutorix.ai_runway_artifact_index.v1",
    source: "adjutorix-ai-runway-artifact-index",
    indexed_at: new Date().toISOString(),
    workspace,
    artifact_count: artifacts.length,
    counts_by_schema: countsBySchema,
    artifacts,
  };
}

function installAdjutorixAiRunwayArtifactIndex(): void {
  if (document.getElementById("adjutorix-ai-runway-artifact-index")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-artifact-index";
  panel.className = "adjutorix-ai-runway-artifact-index";
  panel.setAttribute("aria-label", "Adjutorix AI runway artifact index");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-artifact-index-header";

  const title = document.createElement("strong");
  title.textContent = "Artifact Index";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-artifact-index-confirm";
  confirm.placeholder = "Type INDEX";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-artifact-index-actions";

  const buildButton = document.createElement("button");
  buildButton.type = "button";
  buildButton.textContent = "Build Index";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Index";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Index";

  actions.appendChild(buildButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-artifact-index-output";
  output.textContent = "Artifact index mounted. Build index before writing.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function writeIndex(index: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixArtifactIndexWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixArtifactIndexString(index.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixArtifactIndexTimestamp()}-artifact-index.json`;
    const content = JSON.stringify(index, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  buildButton.addEventListener("click", () => {
    void (async () => {
      setBusy(buildButton, true);
      try {
        const index = await adjutorixArtifactIndexBuild();
        setOutput(JSON.stringify(index, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_READY", JSON.stringify({
          source: "adjutorix-ai-runway-artifact-index",
          workspace: index.workspace,
          artifact_count: index.artifact_count,
        }));
      } catch (error) {
        setOutput(`ARTIFACT INDEX BUILD FAILED\n${String(error)}`);
      } finally {
        setBusy(buildButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "INDEX") {
        setOutput("Artifact index write blocked. Type INDEX in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const index = await adjutorixArtifactIndexBuild();
        const written = await writeIndex(index);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, index }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-artifact-index",
          workspace: index.workspace,
          path: written.path,
          bytes: written.bytes,
          artifact_count: index.artifact_count,
        }));
      } catch (error) {
        setOutput(`ARTIFACT INDEX WRITE FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-artifact-index",
    reads: ".adjutorix-ai-runway",
    writes: ".adjutorix-ai-runway",
    requires: "manual-index-confirmation",
    indexes: "json-artifacts",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayArtifactIndex, { once: true });
} else {
  installAdjutorixAiRunwayArtifactIndex();
}


/**
 * ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_VERIFIER_V1
 *
 * Artifact index verifier:
 * - scans .adjutorix-ai-runway for artifact-index JSON files
 * - reads a selected index through workspace OS
 * - validates index schema/source/workspace/counts
 * - re-reads each indexed artifact
 * - recomputes SHA-256 and compares against index entries
 * - emits an index verification report
 */

interface AdjutorixArtifactIndexVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixArtifactIndexVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixArtifactIndexVerifierWorkspaceBridge;
}

interface AdjutorixArtifactIndexVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixArtifactIndexVerifierWindow(): AdjutorixArtifactIndexVerifierRuntimeWindow {
  return window as unknown as AdjutorixArtifactIndexVerifierRuntimeWindow;
}

function adjutorixArtifactIndexVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixArtifactIndexVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixArtifactIndexVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixArtifactIndexVerifierNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function adjutorixArtifactIndexVerifierPath(value: unknown): string {
  const record = adjutorixArtifactIndexVerifierRecord(value);
  return adjutorixArtifactIndexVerifierString(record.path || record.relativePath || record.file || record.name);
}

async function adjutorixArtifactIndexVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixArtifactIndexVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixArtifactIndexVerifierRecord(defaults);
    const workspace = adjutorixArtifactIndexVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixArtifactIndexVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixArtifactIndexVerifierRecord(scanResult);
  const files = adjutorixArtifactIndexVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixArtifactIndexVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("artifact-index"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixArtifactIndexVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixArtifactIndexVerifierValidateIndex(index: Record<string, unknown>): AdjutorixArtifactIndexVerifierValidation {
  const failures: string[] = [];
  const artifacts = adjutorixArtifactIndexVerifierArray(index.artifacts);
  const artifactCount = adjutorixArtifactIndexVerifierNumber(index.artifact_count);

  if (index.schema !== "adjutorix.ai_runway_artifact_index.v1") {
    failures.push("schema_mismatch");
  }

  if (index.source !== "adjutorix-ai-runway-artifact-index") {
    failures.push("source_mismatch");
  }

  if (!adjutorixArtifactIndexVerifierString(index.indexed_at)) {
    failures.push("indexed_at_missing");
  }

  if (!adjutorixArtifactIndexVerifierString(index.workspace)) {
    failures.push("workspace_missing");
  }

  if (!Array.isArray(index.artifacts)) {
    failures.push("artifacts_not_array");
  }

  if (artifactCount !== artifacts.length) {
    failures.push("artifact_count_mismatch");
  }

  if (typeof index.counts_by_schema !== "object" || index.counts_by_schema === null || Array.isArray(index.counts_by_schema)) {
    failures.push("counts_by_schema_invalid");
  }

  return { ok: failures.length === 0, failures };
}

async function adjutorixArtifactIndexVerifierVerifyArtifacts(
  workspace: string,
  index: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const bridge = adjutorixArtifactIndexVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.readText) {
    throw new Error("workspace_read_bridge_unavailable");
  }

  const artifacts = adjutorixArtifactIndexVerifierArray(index.artifacts);
  const results: Array<Record<string, unknown>> = [];

  for (const artifact of artifacts) {
    const record = adjutorixArtifactIndexVerifierRecord(artifact);
    const path = adjutorixArtifactIndexVerifierString(record.path);
    const expectedSha256 = adjutorixArtifactIndexVerifierString(record.sha256);

    if (!path) {
      results.push({
        ok: false,
        path,
        failure: "artifact_path_missing",
      });
      continue;
    }

    try {
      const readResult = await bridge.readText({ workspace, path });
      const readRecord = adjutorixArtifactIndexVerifierRecord(readResult);
      const content = adjutorixArtifactIndexVerifierString(readRecord.content || readResult);
      const actualSha256 = await adjutorixArtifactIndexVerifierSha256(content);

      results.push({
        ok: actualSha256 === expectedSha256,
        path,
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256,
        bytes: content.length,
        failure: actualSha256 === expectedSha256 ? "" : "sha256_mismatch",
      });
    } catch (error) {
      results.push({
        ok: false,
        path,
        expected_sha256: expectedSha256,
        actual_sha256: "",
        failure: String(error),
      });
    }
  }

  return results;
}

function installAdjutorixAiRunwayArtifactIndexVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-artifact-index-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-artifact-index-verifier";
  panel.className = "adjutorix-ai-runway-artifact-index-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway artifact index verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-artifact-index-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Index Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-artifact-index-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-artifact-index-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-artifact-index-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Indexes";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Index";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-artifact-index-verifier-output";
  output.textContent = "Artifact index verifier mounted. Scan for indexes.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixArtifactIndexVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixArtifactIndexVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const indexes = adjutorixArtifactIndexVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const indexPath of indexes) {
          const option = document.createElement("option");
          option.value = indexPath;
          option.textContent = indexPath;
          select.appendChild(option);
        }

        setState(indexes.length ? "indexes found" : "no indexes");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          index_count: indexes.length,
          indexes,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-artifact-index-verifier",
          workspace,
          index_count: indexes.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`INDEX SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixArtifactIndexVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No artifact index selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixArtifactIndexVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixArtifactIndexVerifierRecord(readResult);
        const content = adjutorixArtifactIndexVerifierString(readRecord.content || readResult);
        const parsed = adjutorixArtifactIndexVerifierRecord(JSON.parse(content));
        const indexSha256 = await adjutorixArtifactIndexVerifierSha256(content);
        const indexValidation = adjutorixArtifactIndexVerifierValidateIndex(parsed);
        const artifactResults = await adjutorixArtifactIndexVerifierVerifyArtifacts(workspace, parsed);
        const artifactFailures = artifactResults.filter((result) => result.ok !== true);
        const ok = indexValidation.ok && artifactFailures.length === 0;

        const report = {
          schema: "adjutorix.ai_runway_artifact_index_verification_report.v1",
          source: "adjutorix-ai-runway-artifact-index-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          index_sha256: indexSha256,
          ok,
          index_validation: indexValidation,
          artifact_count: artifactResults.length,
          artifact_failure_count: artifactFailures.length,
          artifact_results: artifactResults,
          index: parsed,
        };

        setState(ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-artifact-index-verifier",
          workspace,
          path: select.value,
          index_sha256: indexSha256,
          ok,
          artifact_count: artifactResults.length,
          artifact_failure_count: artifactFailures.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`INDEX VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_ARTIFACT_INDEX_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-artifact-index-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_artifact_index.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayArtifactIndexVerifier, { once: true });
} else {
  installAdjutorixAiRunwayArtifactIndexVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_V1
 *
 * Finality manifest recorder:
 * - summarizes the AI runway mission surface chain
 * - captures mission/control/verifier/index panel evidence text
 * - computes SHA-256 over each captured surface payload
 * - captures provider status and git diff snapshot when available
 * - writes a durable finality manifest JSON under .adjutorix-ai-runway/
 * - requires manual FINALIZE confirmation
 */

interface AdjutorixFinalityManifestWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  gitDiff?: (request: { workspace?: string }) => Promise<unknown>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixFinalityManifestAiBridge {
  status?: () => Promise<unknown>;
}

interface AdjutorixFinalityManifestRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixFinalityManifestWorkspaceBridge;
  adjutorixAI?: AdjutorixFinalityManifestAiBridge;
}

function adjutorixFinalityManifestWindow(): AdjutorixFinalityManifestRuntimeWindow {
  return window as unknown as AdjutorixFinalityManifestRuntimeWindow;
}

function adjutorixFinalityManifestRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixFinalityManifestString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixFinalityManifestText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixFinalityManifestMounted(selector: string): boolean {
  return Boolean(document.querySelector(selector));
}

function adjutorixFinalityManifestTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixFinalityManifestSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function adjutorixFinalityManifestWorkspace(): Promise<string> {
  const bridge = adjutorixFinalityManifestWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixFinalityManifestRecord(defaults);
    const workspace = adjutorixFinalityManifestString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixFinalityManifestPayload(name: string, selector: string): Promise<Record<string, unknown>> {
  const text = adjutorixFinalityManifestText(selector);

  return {
    name,
    selector,
    present: Boolean(text),
    chars: text.length,
    sha256: await adjutorixFinalityManifestSha256(text),
    text,
  };
}

async function adjutorixFinalityManifestBuild(note: string): Promise<Record<string, unknown>> {
  const runtime = adjutorixFinalityManifestWindow();
  const workspace = await adjutorixFinalityManifestWorkspace();

  if (!workspace) {
    throw new Error("workspace_not_resolved");
  }

  let providers: unknown = {};
  let diffSnapshot = "";

  if (runtime.adjutorixAI?.status) {
    try {
      providers = await runtime.adjutorixAI.status();
    } catch (error) {
      providers = { ok: false, error: String(error) };
    }
  }

  if (runtime.adjutorixWorkspaceOS?.gitDiff) {
    try {
      const diff = await runtime.adjutorixWorkspaceOS.gitDiff({ workspace });
      diffSnapshot = typeof diff === "string" ? diff : JSON.stringify(diff, null, 2);
    } catch (error) {
      diffSnapshot = `git_diff_unavailable: ${String(error)}`;
    }
  }

  const surfaces = {
    ai_assistant: adjutorixFinalityManifestMounted("#adjutorix-ai-assistant"),
    patch_runway: adjutorixFinalityManifestMounted("#adjutorix-ai-patch-runway"),
    verify_runway: adjutorixFinalityManifestMounted("#adjutorix-ai-patch-verify-runway"),
    evidence_recorder: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-evidence-recorder"),
    context_pack: adjutorixFinalityManifestMounted("#adjutorix-ai-workspace-context-pack"),
    mission_control: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-mission-control"),
    mission_lock: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-mission-lock"),
    lock_verifier: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-lock-verifier"),
    verification_seal: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-verification-seal"),
    seal_verifier: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-seal-verifier"),
    artifact_index: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-artifact-index"),
    artifact_index_verifier: adjutorixFinalityManifestMounted("#adjutorix-ai-runway-artifact-index-verifier"),
  };

  const payloads = [
    await adjutorixFinalityManifestPayload("ai_provider_output", ".adjutorix-ai-output"),
    await adjutorixFinalityManifestPayload("context_pack", ".adjutorix-ai-context-output"),
    await adjutorixFinalityManifestPayload("patch_plan", ".adjutorix-ai-patch-output"),
    await adjutorixFinalityManifestPayload("verify_output", ".adjutorix-ai-patch-verify-output"),
    await adjutorixFinalityManifestPayload("evidence_recorder", ".adjutorix-ai-evidence-output"),
    await adjutorixFinalityManifestPayload("mission_control", ".adjutorix-ai-mission-output"),
    await adjutorixFinalityManifestPayload("mission_lock", ".adjutorix-ai-mission-lock-output"),
    await adjutorixFinalityManifestPayload("lock_verifier", ".adjutorix-ai-lock-verifier-output"),
    await adjutorixFinalityManifestPayload("verification_seal", ".adjutorix-ai-verification-seal-output"),
    await adjutorixFinalityManifestPayload("seal_verifier", ".adjutorix-ai-seal-verifier-output"),
    await adjutorixFinalityManifestPayload("artifact_index", ".adjutorix-ai-artifact-index-output"),
    await adjutorixFinalityManifestPayload("artifact_index_verifier", ".adjutorix-ai-artifact-index-verifier-output"),
  ];

  const surfaceReady = Object.values(surfaces).every(Boolean);
  const diffSha256 = await adjutorixFinalityManifestSha256(diffSnapshot);

  return {
    schema: "adjutorix.ai_runway_finality_manifest.v1",
    source: "adjutorix-ai-runway-finality-manifest",
    finalized_at: new Date().toISOString(),
    workspace,
    operator_note: note,
    ready: surfaceReady,
    surfaces,
    providers,
    payloads,
    git_diff_snapshot: diffSnapshot,
    git_diff_sha256: diffSha256,
  };
}

function installAdjutorixAiRunwayFinalityManifest(): void {
  if (document.getElementById("adjutorix-ai-runway-finality-manifest")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-finality-manifest";
  panel.className = "adjutorix-ai-runway-finality-manifest";
  panel.setAttribute("aria-label", "Adjutorix AI runway finality manifest");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-finality-manifest-header";

  const title = document.createElement("strong");
  title.textContent = "Finality Manifest";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-finality-manifest-confirm";
  confirm.placeholder = "Type FINALIZE";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-finality-manifest-note";
  note.placeholder = "Operator finality note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-finality-manifest-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Manifest";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Manifest";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Manifest";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-finality-manifest-output";
  output.textContent = "Finality manifest mounted. Type FINALIZE before writing.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function writeManifest(manifest: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixFinalityManifestWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixFinalityManifestString(manifest.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixFinalityManifestTimestamp()}-finality-manifest.json`;
    const content = JSON.stringify(manifest, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const manifest = await adjutorixFinalityManifestBuild(note.value);
        setOutput(JSON.stringify(manifest, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_READY", JSON.stringify({
          source: "adjutorix-ai-runway-finality-manifest",
          workspace: manifest.workspace,
          ready: manifest.ready,
        }));
      } catch (error) {
        setOutput(`FINALITY MANIFEST PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "FINALIZE") {
        setOutput("Finality manifest write blocked. Type FINALIZE in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const manifest = await adjutorixFinalityManifestBuild(note.value);
        const written = await writeManifest(manifest);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, manifest }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-finality-manifest",
          workspace: manifest.workspace,
          path: written.path,
          bytes: written.bytes,
          ready: manifest.ready,
        }));
      } catch (error) {
        setOutput(`FINALITY MANIFEST WRITE FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-finality-manifest",
    writes: ".adjutorix-ai-runway",
    requires: "manual-finalize-confirmation",
    summarizes: "ai-runway-artifact-chain",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayFinalityManifest, { once: true });
} else {
  installAdjutorixAiRunwayFinalityManifest();
}


/**
 * ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_VERIFIER_V1
 *
 * Finality manifest verifier:
 * - scans .adjutorix-ai-runway for finality-manifest JSON files
 * - reads selected manifest through workspace OS
 * - validates manifest schema/source/workspace/surfaces/payload hashes
 * - recomputes SHA-256 for captured payload text and git diff snapshot
 * - emits finality verification report
 */

interface AdjutorixFinalityManifestVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixFinalityManifestVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixFinalityManifestVerifierWorkspaceBridge;
}

interface AdjutorixFinalityManifestVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixFinalityManifestVerifierWindow(): AdjutorixFinalityManifestVerifierRuntimeWindow {
  return window as unknown as AdjutorixFinalityManifestVerifierRuntimeWindow;
}

function adjutorixFinalityManifestVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixFinalityManifestVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixFinalityManifestVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixFinalityManifestVerifierBoolean(value: unknown): boolean {
  return value === true;
}

function adjutorixFinalityManifestVerifierPath(value: unknown): string {
  const record = adjutorixFinalityManifestVerifierRecord(value);
  return adjutorixFinalityManifestVerifierString(record.path || record.relativePath || record.file || record.name);
}

async function adjutorixFinalityManifestVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixFinalityManifestVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixFinalityManifestVerifierRecord(defaults);
    const workspace = adjutorixFinalityManifestVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixFinalityManifestVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixFinalityManifestVerifierRecord(scanResult);
  const files = adjutorixFinalityManifestVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixFinalityManifestVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("finality-manifest"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixFinalityManifestVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function adjutorixFinalityManifestVerifierValidatePayloads(
  manifest: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const payloads = adjutorixFinalityManifestVerifierArray(manifest.payloads);
  const results: Array<Record<string, unknown>> = [];

  for (const payload of payloads) {
    const record = adjutorixFinalityManifestVerifierRecord(payload);
    const name = adjutorixFinalityManifestVerifierString(record.name);
    const expectedSha256 = adjutorixFinalityManifestVerifierString(record.sha256);
    const text = adjutorixFinalityManifestVerifierString(record.text);
    const actualSha256 = await adjutorixFinalityManifestVerifierSha256(text);

    results.push({
      ok: expectedSha256 === actualSha256,
      name,
      selector: adjutorixFinalityManifestVerifierString(record.selector),
      chars: text.length,
      expected_sha256: expectedSha256,
      actual_sha256: actualSha256,
      failure: expectedSha256 === actualSha256 ? "" : "payload_sha256_mismatch",
    });
  }

  return results;
}

function adjutorixFinalityManifestVerifierValidateManifest(
  manifest: Record<string, unknown>,
): AdjutorixFinalityManifestVerifierValidation {
  const failures: string[] = [];
  const surfaces = adjutorixFinalityManifestVerifierRecord(manifest.surfaces);
  const payloads = adjutorixFinalityManifestVerifierArray(manifest.payloads);

  if (manifest.schema !== "adjutorix.ai_runway_finality_manifest.v1") {
    failures.push("schema_mismatch");
  }

  if (manifest.source !== "adjutorix-ai-runway-finality-manifest") {
    failures.push("source_mismatch");
  }

  if (!adjutorixFinalityManifestVerifierString(manifest.finalized_at)) {
    failures.push("finalized_at_missing");
  }

  if (!adjutorixFinalityManifestVerifierString(manifest.workspace)) {
    failures.push("workspace_missing");
  }

  if (manifest.ready !== true) {
    failures.push("ready_not_true");
  }

  if (!Object.keys(surfaces).length) {
    failures.push("surfaces_missing");
  }

  if (Object.keys(surfaces).some((key) => surfaces[key] !== true)) {
    failures.push("surface_not_true");
  }

  if (!payloads.length) {
    failures.push("payloads_missing");
  }

  if (!adjutorixFinalityManifestVerifierString(manifest.git_diff_sha256)) {
    failures.push("git_diff_sha256_missing");
  }

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayFinalityManifestVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-finality-manifest-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-finality-manifest-verifier";
  panel.className = "adjutorix-ai-runway-finality-manifest-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway finality manifest verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-finality-manifest-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Finality Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-finality-manifest-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-finality-manifest-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-finality-manifest-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Manifests";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Manifest";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-finality-manifest-verifier-output";
  output.textContent = "Finality manifest verifier mounted. Scan for finality manifests.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixFinalityManifestVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixFinalityManifestVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const manifests = adjutorixFinalityManifestVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const manifestPath of manifests) {
          const option = document.createElement("option");
          option.value = manifestPath;
          option.textContent = manifestPath;
          select.appendChild(option);
        }

        setState(manifests.length ? "manifests found" : "no manifests");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          manifest_count: manifests.length,
          manifests,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-finality-manifest-verifier",
          workspace,
          manifest_count: manifests.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`FINALITY MANIFEST SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixFinalityManifestVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No finality manifest selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixFinalityManifestVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixFinalityManifestVerifierRecord(readResult);
        const content = adjutorixFinalityManifestVerifierString(readRecord.content || readResult);
        const parsed = adjutorixFinalityManifestVerifierRecord(JSON.parse(content));
        const manifestSha256 = await adjutorixFinalityManifestVerifierSha256(content);
        const manifestValidation = adjutorixFinalityManifestVerifierValidateManifest(parsed);
        const payloadResults = await adjutorixFinalityManifestVerifierValidatePayloads(parsed);
        const payloadFailures = payloadResults.filter((result) => result.ok !== true);

        const gitDiffText = adjutorixFinalityManifestVerifierString(parsed.git_diff_snapshot);
        const expectedGitDiffSha256 = adjutorixFinalityManifestVerifierString(parsed.git_diff_sha256);
        const actualGitDiffSha256 = await adjutorixFinalityManifestVerifierSha256(gitDiffText);
        const gitDiffOk = expectedGitDiffSha256 === actualGitDiffSha256;

        const ok = manifestValidation.ok && payloadFailures.length === 0 && gitDiffOk;

        const report = {
          schema: "adjutorix.ai_runway_finality_manifest_verification_report.v1",
          source: "adjutorix-ai-runway-finality-manifest-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          manifest_sha256: manifestSha256,
          ok,
          manifest_validation: manifestValidation,
          payload_count: payloadResults.length,
          payload_failure_count: payloadFailures.length,
          payload_results: payloadResults,
          git_diff_hash: {
            ok: gitDiffOk,
            expected_sha256: expectedGitDiffSha256,
            actual_sha256: actualGitDiffSha256,
          },
          manifest: parsed,
        };

        setState(ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-finality-manifest-verifier",
          workspace,
          path: select.value,
          manifest_sha256: manifestSha256,
          ok,
          payload_count: payloadResults.length,
          payload_failure_count: payloadFailures.length,
          git_diff_ok: gitDiffOk,
        }));
      } catch (error) {
        setState("error");
        setOutput(`FINALITY MANIFEST VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_FINALITY_MANIFEST_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-finality-manifest-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_finality_manifest.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayFinalityManifestVerifier, { once: true });
} else {
  installAdjutorixAiRunwayFinalityManifestVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_V1
 *
 * Finality certificate recorder:
 * - consumes finality-manifest-verifier report output
 * - validates verifier report schema/source/ok/hash fields
 * - computes SHA-256 for report text and mission snapshot text
 * - records a finality certificate JSON into .adjutorix-ai-runway/
 * - requires manual CERTIFY confirmation
 */

interface AdjutorixFinalityCertificateWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixFinalityCertificateRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixFinalityCertificateWorkspaceBridge;
}

function adjutorixFinalityCertificateWindow(): AdjutorixFinalityCertificateRuntimeWindow {
  return window as unknown as AdjutorixFinalityCertificateRuntimeWindow;
}

function adjutorixFinalityCertificateRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixFinalityCertificateString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixFinalityCertificateText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixFinalityCertificateTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixFinalityCertificateWorkspace(): Promise<string> {
  const bridge = adjutorixFinalityCertificateWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixFinalityCertificateRecord(defaults);
    const workspace = adjutorixFinalityCertificateString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixFinalityCertificateSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixFinalityCertificateParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("finality_verification_report_empty");
  }

  const parsed = adjutorixFinalityCertificateRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_finality_manifest_verification_report.v1") {
    throw new Error("finality_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-finality-manifest-verifier") {
    throw new Error("finality_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("finality_verification_report_not_ok");
  }

  if (!adjutorixFinalityCertificateString(parsed.workspace)) {
    throw new Error("finality_verification_report_workspace_missing");
  }

  if (!adjutorixFinalityCertificateString(parsed.path)) {
    throw new Error("finality_verification_report_path_missing");
  }

  if (!adjutorixFinalityCertificateString(parsed.manifest_sha256)) {
    throw new Error("finality_verification_report_manifest_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayFinalityCertificate(): void {
  if (document.getElementById("adjutorix-ai-runway-finality-certificate")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-finality-certificate";
  panel.className = "adjutorix-ai-runway-finality-certificate";
  panel.setAttribute("aria-label", "Adjutorix AI runway finality certificate");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-finality-certificate-header";

  const title = document.createElement("strong");
  title.textContent = "Finality Certificate";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-finality-certificate-confirm";
  confirm.placeholder = "Type CERTIFY";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-finality-certificate-note";
  note.placeholder = "Operator certificate note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-finality-certificate-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Certificate";

  const certifyButton = document.createElement("button");
  certifyButton.type = "button";
  certifyButton.textContent = "Write Certificate";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Certificate";

  actions.appendChild(previewButton);
  actions.appendChild(certifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-finality-certificate-output";
  output.textContent = "Finality certificate mounted. Verify a finality manifest first, then type CERTIFY.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildCertificate(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixFinalityCertificateWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const reportText = adjutorixFinalityCertificateText(".adjutorix-ai-finality-manifest-verifier-output");
    const report = adjutorixFinalityCertificateParseReport(reportText);
    const reportSha256 = await adjutorixFinalityCertificateSha256(reportText);
    const missionSnapshotText = adjutorixFinalityCertificateText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixFinalityCertificateSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_finality_certificate.v1",
      source: "adjutorix-ai-runway-finality-certificate",
      certified_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      finality_verification_report_sha256: reportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      finality_verification_report: report,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeCertificate(certificate: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixFinalityCertificateWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixFinalityCertificateString(certificate.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixFinalityCertificateTimestamp()}-finality-certificate.json`;
    const content = JSON.stringify(certificate, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const certificate = await buildCertificate();
        setOutput(JSON.stringify(certificate, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_READY", JSON.stringify({
          source: "adjutorix-ai-runway-finality-certificate",
          workspace: certificate.workspace,
        }));
      } catch (error) {
        setOutput(`FINALITY CERTIFICATE PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  certifyButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "CERTIFY") {
        setOutput("Finality certificate blocked. Type CERTIFY in the confirmation field.");
        return;
      }

      setBusy(certifyButton, true);
      try {
        const certificate = await buildCertificate();
        const written = await writeCertificate(certificate);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, certificate }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-finality-certificate",
          workspace: certificate.workspace,
          path: written.path,
          bytes: written.bytes,
          certifies: "adjutorix.ai_runway_finality_manifest_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`FINALITY CERTIFICATE FAILED\n${String(error)}`);
      } finally {
        setBusy(certifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-finality-certificate",
    writes: ".adjutorix-ai-runway",
    requires: "manual-certify-confirmation",
    certifies: "adjutorix.ai_runway_finality_manifest_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayFinalityCertificate, { once: true });
} else {
  installAdjutorixAiRunwayFinalityCertificate();
}


/**
 * ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_VERIFIER_V1
 *
 * Finality certificate verifier:
 * - scans .adjutorix-ai-runway for finality-certificate JSON files
 * - reads selected certificate through workspace OS
 * - validates certificate schema/source/workspace/hash/report fields
 * - recomputes certificate file SHA-256
 * - recomputes mission snapshot SHA-256 from embedded snapshot text
 * - emits certificate verification report
 */

interface AdjutorixFinalityCertificateVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixFinalityCertificateVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixFinalityCertificateVerifierWorkspaceBridge;
}

interface AdjutorixFinalityCertificateVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixFinalityCertificateVerifierWindow(): AdjutorixFinalityCertificateVerifierRuntimeWindow {
  return window as unknown as AdjutorixFinalityCertificateVerifierRuntimeWindow;
}

function adjutorixFinalityCertificateVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixFinalityCertificateVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixFinalityCertificateVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixFinalityCertificateVerifierPath(value: unknown): string {
  const record = adjutorixFinalityCertificateVerifierRecord(value);
  return adjutorixFinalityCertificateVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixFinalityCertificateVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixFinalityCertificateVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixFinalityCertificateVerifierRecord(defaults);
    const workspace = adjutorixFinalityCertificateVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixFinalityCertificateVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixFinalityCertificateVerifierRecord(scanResult);
  const files = adjutorixFinalityCertificateVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixFinalityCertificateVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("finality-certificate"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixFinalityCertificateVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixFinalityCertificateVerifierValidate(
  certificate: Record<string, unknown>,
  actualMissionSnapshotSha256: string,
): AdjutorixFinalityCertificateVerifierValidation {
  const failures: string[] = [];
  const report = adjutorixFinalityCertificateVerifierRecord(certificate.finality_verification_report);

  if (certificate.schema !== "adjutorix.ai_runway_finality_certificate.v1") {
    failures.push("schema_mismatch");
  }

  if (certificate.source !== "adjutorix-ai-runway-finality-certificate") {
    failures.push("source_mismatch");
  }

  if (!adjutorixFinalityCertificateVerifierString(certificate.certified_at)) {
    failures.push("certified_at_missing");
  }

  if (!adjutorixFinalityCertificateVerifierString(certificate.workspace)) {
    failures.push("workspace_missing");
  }

  if (!adjutorixFinalityCertificateVerifierString(certificate.finality_verification_report_sha256)) {
    failures.push("finality_verification_report_sha256_missing");
  }

  if (!adjutorixFinalityCertificateVerifierString(certificate.mission_snapshot_sha256)) {
    failures.push("mission_snapshot_sha256_missing");
  }

  if (!adjutorixFinalityCertificateVerifierString(certificate.mission_control_snapshot_text)) {
    failures.push("mission_control_snapshot_text_missing");
  }

  if (certificate.mission_snapshot_sha256 !== actualMissionSnapshotSha256) {
    failures.push("mission_snapshot_sha256_mismatch");
  }

  if (report.schema !== "adjutorix.ai_runway_finality_manifest_verification_report.v1") {
    failures.push("finality_verification_report_schema_mismatch");
  }

  if (report.source !== "adjutorix-ai-runway-finality-manifest-verifier") {
    failures.push("finality_verification_report_source_mismatch");
  }

  if (report.ok !== true) {
    failures.push("finality_verification_report_not_ok");
  }

  if (!adjutorixFinalityCertificateVerifierString(report.workspace)) {
    failures.push("finality_verification_report_workspace_missing");
  }

  if (!adjutorixFinalityCertificateVerifierString(report.path)) {
    failures.push("finality_verification_report_path_missing");
  }

  if (!adjutorixFinalityCertificateVerifierString(report.manifest_sha256)) {
    failures.push("finality_verification_report_manifest_sha256_missing");
  }

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayFinalityCertificateVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-finality-certificate-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-finality-certificate-verifier";
  panel.className = "adjutorix-ai-runway-finality-certificate-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway finality certificate verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-finality-certificate-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Certificate Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-finality-certificate-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-finality-certificate-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-finality-certificate-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Certificates";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Certificate";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-finality-certificate-verifier-output";
  output.textContent = "Finality certificate verifier mounted. Scan for certificates.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixFinalityCertificateVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixFinalityCertificateVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const certificates = adjutorixFinalityCertificateVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const certificatePath of certificates) {
          const option = document.createElement("option");
          option.value = certificatePath;
          option.textContent = certificatePath;
          select.appendChild(option);
        }

        setState(certificates.length ? "certificates found" : "no certificates");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          certificate_count: certificates.length,
          certificates,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-finality-certificate-verifier",
          workspace,
          certificate_count: certificates.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`FINALITY CERTIFICATE SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixFinalityCertificateVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No finality certificate selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixFinalityCertificateVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixFinalityCertificateVerifierRecord(readResult);
        const content = adjutorixFinalityCertificateVerifierString(readRecord.content || readResult);
        const parsed = adjutorixFinalityCertificateVerifierRecord(JSON.parse(content));
        const certificateSha256 = await adjutorixFinalityCertificateVerifierSha256(content);
        const missionSnapshotText = adjutorixFinalityCertificateVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixFinalityCertificateVerifierSha256(missionSnapshotText);
        const validation = adjutorixFinalityCertificateVerifierValidate(parsed, missionSnapshotSha256);

        const report = {
          schema: "adjutorix.ai_runway_finality_certificate_verification_report.v1",
          source: "adjutorix-ai-runway-finality-certificate-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          certificate_sha256: certificateSha256,
          ok: validation.ok,
          validation,
          hashes: {
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          certificate: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-finality-certificate-verifier",
          workspace,
          path: select.value,
          certificate_sha256: certificateSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`FINALITY CERTIFICATE VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_FINALITY_CERTIFICATE_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-finality-certificate-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_finality_certificate.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayFinalityCertificateVerifier, { once: true });
} else {
  installAdjutorixAiRunwayFinalityCertificateVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_V1
 *
 * Terminal attestation recorder:
 * - consumes finality-certificate-verifier report output
 * - validates certificate-verifier report schema/source/ok/hash fields
 * - computes SHA-256 over verifier report and mission snapshot text
 * - records terminal attestation JSON into .adjutorix-ai-runway/
 * - requires manual ATTEST confirmation
 */

interface AdjutorixTerminalAttestationWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalAttestationRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalAttestationWorkspaceBridge;
}

function adjutorixTerminalAttestationWindow(): AdjutorixTerminalAttestationRuntimeWindow {
  return window as unknown as AdjutorixTerminalAttestationRuntimeWindow;
}

function adjutorixTerminalAttestationRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalAttestationString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalAttestationText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalAttestationTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalAttestationWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalAttestationWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalAttestationRecord(defaults);
    const workspace = adjutorixTerminalAttestationString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalAttestationSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalAttestationParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("finality_certificate_verification_report_empty");
  }

  const parsed = adjutorixTerminalAttestationRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_finality_certificate_verification_report.v1") {
    throw new Error("finality_certificate_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-finality-certificate-verifier") {
    throw new Error("finality_certificate_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("finality_certificate_verification_report_not_ok");
  }

  if (!adjutorixTerminalAttestationString(parsed.workspace)) {
    throw new Error("finality_certificate_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalAttestationString(parsed.path)) {
    throw new Error("finality_certificate_verification_report_path_missing");
  }

  if (!adjutorixTerminalAttestationString(parsed.certificate_sha256)) {
    throw new Error("finality_certificate_verification_report_certificate_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalAttestation(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-attestation")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-attestation";
  panel.className = "adjutorix-ai-runway-terminal-attestation";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal attestation");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-attestation-header";

  const title = document.createElement("strong");
  title.textContent = "Terminal Attestation";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-attestation-confirm";
  confirm.placeholder = "Type ATTEST";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-attestation-note";
  note.placeholder = "Operator terminal attestation note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-attestation-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Attestation";

  const attestButton = document.createElement("button");
  attestButton.type = "button";
  attestButton.textContent = "Write Attestation";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Attestation";

  actions.appendChild(previewButton);
  actions.appendChild(attestButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-attestation-output";
  output.textContent = "Terminal attestation mounted. Verify a finality certificate first, then type ATTEST.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildAttestation(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalAttestationWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const reportText = adjutorixTerminalAttestationText(".adjutorix-ai-finality-certificate-verifier-output");
    const report = adjutorixTerminalAttestationParseReport(reportText);
    const reportSha256 = await adjutorixTerminalAttestationSha256(reportText);
    const missionSnapshotText = adjutorixTerminalAttestationText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalAttestationSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_attestation.v1",
      source: "adjutorix-ai-runway-terminal-attestation",
      attested_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      finality_certificate_verification_report_sha256: reportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      finality_certificate_verification_report: report,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeAttestation(attestation: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalAttestationWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalAttestationString(attestation.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalAttestationTimestamp()}-terminal-attestation.json`;
    const content = JSON.stringify(attestation, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const attestation = await buildAttestation();
        setOutput(JSON.stringify(attestation, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-attestation",
          workspace: attestation.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL ATTESTATION PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  attestButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "ATTEST") {
        setOutput("Terminal attestation blocked. Type ATTEST in the confirmation field.");
        return;
      }

      setBusy(attestButton, true);
      try {
        const attestation = await buildAttestation();
        const written = await writeAttestation(attestation);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, attestation }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-attestation",
          workspace: attestation.workspace,
          path: written.path,
          bytes: written.bytes,
          attests: "adjutorix.ai_runway_finality_certificate_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL ATTESTATION FAILED\n${String(error)}`);
      } finally {
        setBusy(attestButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-attestation",
    writes: ".adjutorix-ai-runway",
    requires: "manual-attest-confirmation",
    attests: "adjutorix.ai_runway_finality_certificate_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalAttestation, { once: true });
} else {
  installAdjutorixAiRunwayTerminalAttestation();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_VERIFIER_V1
 *
 * Terminal attestation verifier:
 * - scans .adjutorix-ai-runway for terminal-attestation JSON files
 * - reads selected terminal attestation through workspace OS
 * - validates schema/source/workspace/report fields
 * - recomputes SHA-256 over attestation content
 * - recomputes embedded verifier report hash from canonical JSON
 * - recomputes embedded mission snapshot hash
 * - emits terminal attestation verification report
 */

interface AdjutorixTerminalAttestationVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalAttestationVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalAttestationVerifierWorkspaceBridge;
}

interface AdjutorixTerminalAttestationVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalAttestationVerifierWindow(): AdjutorixTerminalAttestationVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalAttestationVerifierRuntimeWindow;
}

function adjutorixTerminalAttestationVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalAttestationVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalAttestationVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalAttestationVerifierPath(value: unknown): string {
  const record = adjutorixTerminalAttestationVerifierRecord(value);
  return adjutorixTerminalAttestationVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalAttestationVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalAttestationVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalAttestationVerifierRecord(defaults);
    const workspace = adjutorixTerminalAttestationVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalAttestationVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalAttestationVerifierRecord(scanResult);
  const files = adjutorixTerminalAttestationVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixTerminalAttestationVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-attestation"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalAttestationVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalAttestationVerifierValidate(
  attestation: Record<string, unknown>,
  actualReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalAttestationVerifierValidation {
  const failures: string[] = [];
  const report = adjutorixTerminalAttestationVerifierRecord(
    attestation.finality_certificate_verification_report,
  );

  if (attestation.schema !== "adjutorix.ai_runway_terminal_attestation.v1") {
    failures.push("schema_mismatch");
  }

  if (attestation.source !== "adjutorix-ai-runway-terminal-attestation") {
    failures.push("source_mismatch");
  }

  if (!adjutorixTerminalAttestationVerifierString(attestation.attested_at)) {
    failures.push("attested_at_missing");
  }

  if (!adjutorixTerminalAttestationVerifierString(attestation.workspace)) {
    failures.push("workspace_missing");
  }

  if (!adjutorixTerminalAttestationVerifierString(attestation.finality_certificate_verification_report_sha256)) {
    failures.push("finality_certificate_verification_report_sha256_missing");
  }

  if (!adjutorixTerminalAttestationVerifierString(attestation.mission_snapshot_sha256)) {
    failures.push("mission_snapshot_sha256_missing");
  }

  if (!adjutorixTerminalAttestationVerifierString(attestation.mission_control_snapshot_text)) {
    failures.push("mission_control_snapshot_text_missing");
  }

  if (attestation.finality_certificate_verification_report_sha256 !== actualReportSha256) {
    failures.push("finality_certificate_verification_report_sha256_mismatch");
  }

  if (attestation.mission_snapshot_sha256 !== actualMissionSnapshotSha256) {
    failures.push("mission_snapshot_sha256_mismatch");
  }

  if (report.schema !== "adjutorix.ai_runway_finality_certificate_verification_report.v1") {
    failures.push("finality_certificate_verification_report_schema_mismatch");
  }

  if (report.source !== "adjutorix-ai-runway-finality-certificate-verifier") {
    failures.push("finality_certificate_verification_report_source_mismatch");
  }

  if (report.ok !== true) {
    failures.push("finality_certificate_verification_report_not_ok");
  }

  if (!adjutorixTerminalAttestationVerifierString(report.workspace)) {
    failures.push("finality_certificate_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalAttestationVerifierString(report.path)) {
    failures.push("finality_certificate_verification_report_path_missing");
  }

  if (!adjutorixTerminalAttestationVerifierString(report.certificate_sha256)) {
    failures.push("finality_certificate_verification_report_certificate_sha256_missing");
  }

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalAttestationVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-attestation-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-attestation-verifier";
  panel.className = "adjutorix-ai-runway-terminal-attestation-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal attestation verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-attestation-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Attestation Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-attestation-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-attestation-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-attestation-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Attestations";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Attestation";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-attestation-verifier-output";
  output.textContent = "Terminal attestation verifier mounted. Scan for attestations.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalAttestationVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalAttestationVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const attestations = adjutorixTerminalAttestationVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const attestationPath of attestations) {
          const option = document.createElement("option");
          option.value = attestationPath;
          option.textContent = attestationPath;
          select.appendChild(option);
        }

        setState(attestations.length ? "attestations found" : "no attestations");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          attestation_count: attestations.length,
          attestations,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-attestation-verifier",
          workspace,
          attestation_count: attestations.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL ATTESTATION SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalAttestationVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal attestation selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalAttestationVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalAttestationVerifierRecord(readResult);
        const content = adjutorixTerminalAttestationVerifierString(readRecord.content || readResult);
        const parsed = adjutorixTerminalAttestationVerifierRecord(JSON.parse(content));
        const attestationSha256 = await adjutorixTerminalAttestationVerifierSha256(content);

        const report = adjutorixTerminalAttestationVerifierRecord(
          parsed.finality_certificate_verification_report,
        );
        const canonicalReportText = JSON.stringify(report, null, 2);
        const actualReportSha256 = await adjutorixTerminalAttestationVerifierSha256(canonicalReportText);

        const missionSnapshotText = adjutorixTerminalAttestationVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixTerminalAttestationVerifierSha256(missionSnapshotText);

        const validation = adjutorixTerminalAttestationVerifierValidate(
          parsed,
          actualReportSha256,
          missionSnapshotSha256,
        );

        const verificationReport = {
          schema: "adjutorix.ai_runway_terminal_attestation_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-attestation-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          attestation_sha256: attestationSha256,
          ok: validation.ok,
          validation,
          hashes: {
            finality_certificate_verification_report: {
              ok: parsed.finality_certificate_verification_report_sha256 === actualReportSha256,
              expected_sha256: parsed.finality_certificate_verification_report_sha256,
              actual_sha256: actualReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          attestation: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(verificationReport, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-attestation-verifier",
          workspace,
          path: select.value,
          attestation_sha256: attestationSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL ATTESTATION VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_ATTESTATION_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-attestation-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_attestation.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalAttestationVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalAttestationVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_V1
 *
 * Terminal control board:
 * - summarizes all mounted AI runway surfaces
 * - resolves workspace through Workspace OS defaults
 * - hashes live output payloads with SHA-256
 * - emits a terminal chain readiness report
 * - does not mutate workspace state
 */

interface AdjutorixTerminalControlBoardWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
}

interface AdjutorixTerminalControlBoardRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalControlBoardWorkspaceBridge;
}

function adjutorixTerminalControlBoardWindow(): AdjutorixTerminalControlBoardRuntimeWindow {
  return window as unknown as AdjutorixTerminalControlBoardRuntimeWindow;
}

function adjutorixTerminalControlBoardRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalControlBoardString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalControlBoardText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalControlBoardMounted(selector: string): boolean {
  return Boolean(document.querySelector(selector));
}

async function adjutorixTerminalControlBoardWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalControlBoardWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalControlBoardRecord(defaults);
    const workspace = adjutorixTerminalControlBoardString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalControlBoardSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function adjutorixTerminalControlBoardPayload(
  name: string,
  selector: string,
): Promise<Record<string, unknown>> {
  const text = adjutorixTerminalControlBoardText(selector);

  return {
    name,
    selector,
    present: text.length > 0,
    chars: text.length,
    sha256: await adjutorixTerminalControlBoardSha256(text),
  };
}

async function adjutorixTerminalControlBoardBuildReport(): Promise<Record<string, unknown>> {
  const workspace = await adjutorixTerminalControlBoardWorkspace();

  const surfaces = {
    ai_assistant: adjutorixTerminalControlBoardMounted("#adjutorix-ai-assistant"),
    patch_runway: adjutorixTerminalControlBoardMounted("#adjutorix-ai-patch-runway"),
    patch_verify_runway: adjutorixTerminalControlBoardMounted("#adjutorix-ai-patch-verify-runway"),
    evidence_recorder: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-evidence-recorder"),
    context_pack: adjutorixTerminalControlBoardMounted("#adjutorix-ai-workspace-context-pack"),
    mission_control: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-mission-control"),
    mission_lock: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-mission-lock"),
    lock_verifier: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-lock-verifier"),
    verification_seal: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-verification-seal"),
    seal_verifier: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-seal-verifier"),
    artifact_index: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-artifact-index"),
    artifact_index_verifier: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-artifact-index-verifier"),
    finality_manifest: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-finality-manifest"),
    finality_manifest_verifier: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-finality-manifest-verifier"),
    finality_certificate: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-finality-certificate"),
    finality_certificate_verifier: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-finality-certificate-verifier"),
    terminal_attestation: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-terminal-attestation"),
    terminal_attestation_verifier: adjutorixTerminalControlBoardMounted("#adjutorix-ai-runway-terminal-attestation-verifier"),
  };

  const payloads = [
    await adjutorixTerminalControlBoardPayload("ai_provider_output", ".adjutorix-ai-output"),
    await adjutorixTerminalControlBoardPayload("context_pack", ".adjutorix-ai-context-output"),
    await adjutorixTerminalControlBoardPayload("patch_plan", ".adjutorix-ai-patch-output"),
    await adjutorixTerminalControlBoardPayload("verify_output", ".adjutorix-ai-patch-verify-output"),
    await adjutorixTerminalControlBoardPayload("evidence_recorder", ".adjutorix-ai-evidence-output"),
    await adjutorixTerminalControlBoardPayload("mission_control", ".adjutorix-ai-mission-output"),
    await adjutorixTerminalControlBoardPayload("mission_lock", ".adjutorix-ai-mission-lock-output"),
    await adjutorixTerminalControlBoardPayload("lock_verifier", ".adjutorix-ai-lock-verifier-output"),
    await adjutorixTerminalControlBoardPayload("verification_seal", ".adjutorix-ai-verification-seal-output"),
    await adjutorixTerminalControlBoardPayload("seal_verifier", ".adjutorix-ai-seal-verifier-output"),
    await adjutorixTerminalControlBoardPayload("artifact_index", ".adjutorix-ai-artifact-index-output"),
    await adjutorixTerminalControlBoardPayload("artifact_index_verifier", ".adjutorix-ai-artifact-index-verifier-output"),
    await adjutorixTerminalControlBoardPayload("finality_manifest", ".adjutorix-ai-finality-manifest-output"),
    await adjutorixTerminalControlBoardPayload("finality_manifest_verifier", ".adjutorix-ai-finality-manifest-verifier-output"),
    await adjutorixTerminalControlBoardPayload("finality_certificate", ".adjutorix-ai-finality-certificate-output"),
    await adjutorixTerminalControlBoardPayload("finality_certificate_verifier", ".adjutorix-ai-finality-certificate-verifier-output"),
    await adjutorixTerminalControlBoardPayload("terminal_attestation", ".adjutorix-ai-terminal-attestation-output"),
    await adjutorixTerminalControlBoardPayload("terminal_attestation_verifier", ".adjutorix-ai-terminal-attestation-verifier-output"),
  ];

  const surfaceEntries = Object.entries(surfaces);
  const missingSurfaces = surfaceEntries
    .filter(([, mounted]) => mounted !== true)
    .map(([name]) => name);

  return {
    schema: "adjutorix.ai_runway_terminal_control_board_report.v1",
    source: "adjutorix-ai-runway-terminal-control-board",
    reported_at: new Date().toISOString(),
    workspace,
    ready: Boolean(workspace) && missingSurfaces.length === 0,
    surface_count: surfaceEntries.length,
    missing_surface_count: missingSurfaces.length,
    missing_surfaces: missingSurfaces,
    surfaces,
    payloads,
  };
}

function installAdjutorixAiRunwayTerminalControlBoard(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-control-board")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-control-board";
  panel.className = "adjutorix-ai-runway-terminal-control-board";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal control board");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-control-board-header";

  const title = document.createElement("strong");
  title.textContent = "Terminal Control Board";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-control-board-state";
  state.textContent = "mounted";

  header.appendChild(title);
  header.appendChild(state);

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-control-board-actions";

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.textContent = "Refresh Board";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(refreshButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-control-board-output";
  output.textContent = "Terminal control board mounted. Refresh for chain readiness.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  refreshButton.addEventListener("click", () => {
    void (async () => {
      setBusy(refreshButton, true);
      setState("refreshing");

      try {
        const report = await adjutorixTerminalControlBoardBuildReport();
        setState(report.ready === true ? "ready" : "incomplete");
        setOutput(JSON.stringify(report, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-control-board",
          workspace: report.workspace,
          ready: report.ready,
          surface_count: report.surface_count,
          missing_surface_count: report.missing_surface_count,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL CONTROL BOARD FAILED\n${String(error)}`);
      } finally {
        setBusy(refreshButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-control-board",
    reads: "mounted-surfaces",
    summarizes: "ai-runway-terminal-chain",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalControlBoard, { once: true });
} else {
  installAdjutorixAiRunwayTerminalControlBoard();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_V1
 *
 * Terminal control board snapshot recorder:
 * - consumes terminal-control-board report output
 * - validates board report schema/source/readiness fields
 * - computes SHA-256 over board report text and mission snapshot text
 * - writes durable terminal board snapshot JSON into .adjutorix-ai-runway/
 * - requires manual SNAPSHOT confirmation
 */

interface AdjutorixTerminalControlBoardSnapshotWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalControlBoardSnapshotRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalControlBoardSnapshotWorkspaceBridge;
}

function adjutorixTerminalControlBoardSnapshotWindow(): AdjutorixTerminalControlBoardSnapshotRuntimeWindow {
  return window as unknown as AdjutorixTerminalControlBoardSnapshotRuntimeWindow;
}

function adjutorixTerminalControlBoardSnapshotRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalControlBoardSnapshotString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalControlBoardSnapshotText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalControlBoardSnapshotTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalControlBoardSnapshotWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalControlBoardSnapshotWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalControlBoardSnapshotRecord(defaults);
    const workspace = adjutorixTerminalControlBoardSnapshotString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalControlBoardSnapshotSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalControlBoardSnapshotParseBoard(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_control_board_report_empty");
  }

  const parsed = adjutorixTerminalControlBoardSnapshotRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_control_board_report.v1") {
    throw new Error("terminal_control_board_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-control-board") {
    throw new Error("terminal_control_board_report_source_mismatch");
  }

  if (!adjutorixTerminalControlBoardSnapshotString(parsed.workspace)) {
    throw new Error("terminal_control_board_report_workspace_missing");
  }

  if (typeof parsed.surface_count !== "number") {
    throw new Error("terminal_control_board_report_surface_count_missing");
  }

  if (typeof parsed.missing_surface_count !== "number") {
    throw new Error("terminal_control_board_report_missing_surface_count_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalControlBoardSnapshot(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-control-board-snapshot")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-control-board-snapshot";
  panel.className = "adjutorix-ai-runway-terminal-control-board-snapshot";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal control board snapshot");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-control-board-snapshot-header";

  const title = document.createElement("strong");
  title.textContent = "Board Snapshot";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-control-board-snapshot-confirm";
  confirm.placeholder = "Type SNAPSHOT";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-control-board-snapshot-note";
  note.placeholder = "Operator terminal board snapshot note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-control-board-snapshot-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Snapshot";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Snapshot";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Snapshot";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-control-board-snapshot-output";
  output.textContent = "Terminal control board snapshot mounted. Refresh board first, then type SNAPSHOT.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildSnapshot(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalControlBoardSnapshotWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const boardText = adjutorixTerminalControlBoardSnapshotText(".adjutorix-ai-terminal-control-board-output");
    const boardReport = adjutorixTerminalControlBoardSnapshotParseBoard(boardText);
    const boardReportSha256 = await adjutorixTerminalControlBoardSnapshotSha256(boardText);
    const missionSnapshotText = adjutorixTerminalControlBoardSnapshotText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalControlBoardSnapshotSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_control_board_snapshot.v1",
      source: "adjutorix-ai-runway-terminal-control-board-snapshot",
      snapshotted_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_control_board_report_sha256: boardReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_control_board_report: boardReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeSnapshot(snapshot: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalControlBoardSnapshotWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalControlBoardSnapshotString(snapshot.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalControlBoardSnapshotTimestamp()}-terminal-control-board-snapshot.json`;
    const content = JSON.stringify(snapshot, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const snapshot = await buildSnapshot();
        setOutput(JSON.stringify(snapshot, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-control-board-snapshot",
          workspace: snapshot.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL CONTROL BOARD SNAPSHOT PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "SNAPSHOT") {
        setOutput("Terminal control board snapshot blocked. Type SNAPSHOT in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const snapshot = await buildSnapshot();
        const written = await writeSnapshot(snapshot);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, snapshot }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-control-board-snapshot",
          workspace: snapshot.workspace,
          path: written.path,
          bytes: written.bytes,
          snapshots: "adjutorix.ai_runway_terminal_control_board_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL CONTROL BOARD SNAPSHOT FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-control-board-snapshot",
    writes: ".adjutorix-ai-runway",
    requires: "manual-snapshot-confirmation",
    snapshots: "adjutorix.ai_runway_terminal_control_board_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalControlBoardSnapshot, { once: true });
} else {
  installAdjutorixAiRunwayTerminalControlBoardSnapshot();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_VERIFIER_V1
 *
 * Terminal control board snapshot verifier:
 * - scans .adjutorix-ai-runway for terminal-control-board-snapshot JSON files
 * - reads selected snapshot through Workspace OS
 * - validates snapshot schema/source/workspace/report fields
 * - recomputes SHA-256 over snapshot content
 * - recomputes embedded board report hash from canonical JSON
 * - recomputes embedded mission snapshot hash
 * - emits snapshot verification report
 */

interface AdjutorixTerminalControlBoardSnapshotVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalControlBoardSnapshotVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalControlBoardSnapshotVerifierWorkspaceBridge;
}

interface AdjutorixTerminalControlBoardSnapshotVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalControlBoardSnapshotVerifierWindow(): AdjutorixTerminalControlBoardSnapshotVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalControlBoardSnapshotVerifierRuntimeWindow;
}

function adjutorixTerminalControlBoardSnapshotVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalControlBoardSnapshotVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalControlBoardSnapshotVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalControlBoardSnapshotVerifierPath(value: unknown): string {
  const record = adjutorixTerminalControlBoardSnapshotVerifierRecord(value);
  return adjutorixTerminalControlBoardSnapshotVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalControlBoardSnapshotVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalControlBoardSnapshotVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalControlBoardSnapshotVerifierRecord(defaults);
    const workspace = adjutorixTerminalControlBoardSnapshotVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalControlBoardSnapshotVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalControlBoardSnapshotVerifierRecord(scanResult);
  const files = adjutorixTerminalControlBoardSnapshotVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixTerminalControlBoardSnapshotVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-control-board-snapshot"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalControlBoardSnapshotVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalControlBoardSnapshotVerifierValidate(
  snapshot: Record<string, unknown>,
  actualBoardReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalControlBoardSnapshotVerifierValidation {
  const failures: string[] = [];
  const boardReport = adjutorixTerminalControlBoardSnapshotVerifierRecord(
    snapshot.terminal_control_board_report,
  );

  if (snapshot.schema !== "adjutorix.ai_runway_terminal_control_board_snapshot.v1") {
    failures.push("schema_mismatch");
  }

  if (snapshot.source !== "adjutorix-ai-runway-terminal-control-board-snapshot") {
    failures.push("source_mismatch");
  }

  if (!adjutorixTerminalControlBoardSnapshotVerifierString(snapshot.snapshotted_at)) {
    failures.push("snapshotted_at_missing");
  }

  if (!adjutorixTerminalControlBoardSnapshotVerifierString(snapshot.workspace)) {
    failures.push("workspace_missing");
  }

  if (!adjutorixTerminalControlBoardSnapshotVerifierString(snapshot.terminal_control_board_report_sha256)) {
    failures.push("terminal_control_board_report_sha256_missing");
  }

  if (!adjutorixTerminalControlBoardSnapshotVerifierString(snapshot.mission_snapshot_sha256)) {
    failures.push("mission_snapshot_sha256_missing");
  }

  if (!adjutorixTerminalControlBoardSnapshotVerifierString(snapshot.mission_control_snapshot_text)) {
    failures.push("mission_control_snapshot_text_missing");
  }

  if (snapshot.terminal_control_board_report_sha256 !== actualBoardReportSha256) {
    failures.push("terminal_control_board_report_sha256_mismatch");
  }

  if (snapshot.mission_snapshot_sha256 !== actualMissionSnapshotSha256) {
    failures.push("mission_snapshot_sha256_mismatch");
  }

  if (boardReport.schema !== "adjutorix.ai_runway_terminal_control_board_report.v1") {
    failures.push("terminal_control_board_report_schema_mismatch");
  }

  if (boardReport.source !== "adjutorix-ai-runway-terminal-control-board") {
    failures.push("terminal_control_board_report_source_mismatch");
  }

  if (!adjutorixTerminalControlBoardSnapshotVerifierString(boardReport.workspace)) {
    failures.push("terminal_control_board_report_workspace_missing");
  }

  if (typeof boardReport.surface_count !== "number") {
    failures.push("terminal_control_board_report_surface_count_missing");
  }

  if (typeof boardReport.missing_surface_count !== "number") {
    failures.push("terminal_control_board_report_missing_surface_count_missing");
  }

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalControlBoardSnapshotVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-control-board-snapshot-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-control-board-snapshot-verifier";
  panel.className = "adjutorix-ai-runway-terminal-control-board-snapshot-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal control board snapshot verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-control-board-snapshot-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Board Snapshot Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-control-board-snapshot-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-control-board-snapshot-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-control-board-snapshot-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Snapshots";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Snapshot";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-control-board-snapshot-verifier-output";
  output.textContent = "Terminal board snapshot verifier mounted. Scan for snapshots.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalControlBoardSnapshotVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalControlBoardSnapshotVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const snapshots = adjutorixTerminalControlBoardSnapshotVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const snapshotPath of snapshots) {
          const option = document.createElement("option");
          option.value = snapshotPath;
          option.textContent = snapshotPath;
          select.appendChild(option);
        }

        setState(snapshots.length ? "snapshots found" : "no snapshots");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          snapshot_count: snapshots.length,
          snapshots,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-control-board-snapshot-verifier",
          workspace,
          snapshot_count: snapshots.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL CONTROL BOARD SNAPSHOT SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalControlBoardSnapshotVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal control board snapshot selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalControlBoardSnapshotVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalControlBoardSnapshotVerifierRecord(readResult);
        const content = adjutorixTerminalControlBoardSnapshotVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalControlBoardSnapshotVerifierRecord(JSON.parse(content));
        const snapshotSha256 = await adjutorixTerminalControlBoardSnapshotVerifierSha256(content);

        const boardReport = adjutorixTerminalControlBoardSnapshotVerifierRecord(parsed.terminal_control_board_report);
        const canonicalBoardReportText = JSON.stringify(boardReport, null, 2);
        const actualBoardReportSha256 = await adjutorixTerminalControlBoardSnapshotVerifierSha256(
          canonicalBoardReportText,
        );

        const missionSnapshotText = adjutorixTerminalControlBoardSnapshotVerifierString(
          parsed.mission_control_snapshot_text,
        );
        const missionSnapshotSha256 = await adjutorixTerminalControlBoardSnapshotVerifierSha256(
          missionSnapshotText,
        );

        const validation = adjutorixTerminalControlBoardSnapshotVerifierValidate(
          parsed,
          actualBoardReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_control_board_snapshot_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-control-board-snapshot-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          snapshot_sha256: snapshotSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_control_board_report: {
              ok: parsed.terminal_control_board_report_sha256 === actualBoardReportSha256,
              expected_sha256: parsed.terminal_control_board_report_sha256,
              actual_sha256: actualBoardReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          snapshot: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-control-board-snapshot-verifier",
          workspace,
          path: select.value,
          snapshot_sha256: snapshotSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL CONTROL BOARD SNAPSHOT VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_CONTROL_BOARD_SNAPSHOT_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-control-board-snapshot-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_control_board_snapshot.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalControlBoardSnapshotVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalControlBoardSnapshotVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_V1
 *
 * Terminal release capsule recorder:
 * - consumes terminal-control-board-snapshot verification report output
 * - validates report schema/source/workspace/path/hash/ok fields
 * - computes SHA-256 over verification report text and mission snapshot text
 * - writes durable terminal release capsule JSON into .adjutorix-ai-runway/
 * - requires manual CAPSULE confirmation
 */

interface AdjutorixTerminalReleaseCapsuleWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseCapsuleRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseCapsuleWorkspaceBridge;
}

function adjutorixTerminalReleaseCapsuleWindow(): AdjutorixTerminalReleaseCapsuleRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseCapsuleRuntimeWindow;
}

function adjutorixTerminalReleaseCapsuleRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseCapsuleString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseCapsuleText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleaseCapsuleTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleaseCapsuleWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseCapsuleWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseCapsuleRecord(defaults);
    const workspace = adjutorixTerminalReleaseCapsuleString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleaseCapsuleSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseCapsuleParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_control_board_snapshot_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleaseCapsuleRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_control_board_snapshot_verification_report.v1") {
    throw new Error("terminal_control_board_snapshot_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-control-board-snapshot-verifier") {
    throw new Error("terminal_control_board_snapshot_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_control_board_snapshot_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleaseCapsuleString(parsed.workspace)) {
    throw new Error("terminal_control_board_snapshot_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleString(parsed.path)) {
    throw new Error("terminal_control_board_snapshot_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleString(parsed.snapshot_sha256)) {
    throw new Error("terminal_control_board_snapshot_verification_report_snapshot_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleaseCapsule(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-capsule")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-capsule";
  panel.className = "adjutorix-ai-runway-terminal-release-capsule";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release capsule");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-capsule-header";

  const title = document.createElement("strong");
  title.textContent = "Release Capsule";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-capsule-confirm";
  confirm.placeholder = "Type CAPSULE";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-capsule-note";
  note.placeholder = "Operator terminal release capsule note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-capsule-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Capsule";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Capsule";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Capsule";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-capsule-output";
  output.textContent = "Terminal release capsule mounted. Verify board snapshot first, then type CAPSULE.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildCapsule(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleaseCapsuleWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const verificationText = adjutorixTerminalReleaseCapsuleText(
      ".adjutorix-ai-terminal-control-board-snapshot-verifier-output",
    );
    const verificationReport = adjutorixTerminalReleaseCapsuleParseReport(verificationText);
    const verificationReportSha256 = await adjutorixTerminalReleaseCapsuleSha256(verificationText);
    const missionSnapshotText = adjutorixTerminalReleaseCapsuleText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleaseCapsuleSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_capsule.v1",
      source: "adjutorix-ai-runway-terminal-release-capsule",
      capsulated_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_control_board_snapshot_verification_report_sha256: verificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_control_board_snapshot_verification_report: verificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeCapsule(capsule: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleaseCapsuleWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleaseCapsuleString(capsule.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleaseCapsuleTimestamp()}-terminal-release-capsule.json`;
    const content = JSON.stringify(capsule, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const capsule = await buildCapsule();
        setOutput(JSON.stringify(capsule, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-capsule",
          workspace: capsule.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE CAPSULE PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "CAPSULE") {
        setOutput("Terminal release capsule blocked. Type CAPSULE in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const capsule = await buildCapsule();
        const written = await writeCapsule(capsule);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, capsule }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-capsule",
          workspace: capsule.workspace,
          path: written.path,
          bytes: written.bytes,
          capsules: "adjutorix.ai_runway_terminal_control_board_snapshot_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE CAPSULE FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-capsule",
    writes: ".adjutorix-ai-runway",
    requires: "manual-capsule-confirmation",
    capsules: "adjutorix.ai_runway_terminal_control_board_snapshot_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseCapsule, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseCapsule();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_VERIFIER_V1
 *
 * Terminal release capsule verifier:
 * - scans .adjutorix-ai-runway for terminal-release-capsule JSON files
 * - reads selected capsule through Workspace OS
 * - validates capsule schema/source/workspace/report fields
 * - recomputes SHA-256 over capsule content
 * - recomputes embedded snapshot-verification report hash from canonical JSON
 * - recomputes embedded mission snapshot hash
 * - emits terminal release capsule verification report
 */

interface AdjutorixTerminalReleaseCapsuleVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseCapsuleVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseCapsuleVerifierWorkspaceBridge;
}

interface AdjutorixTerminalReleaseCapsuleVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalReleaseCapsuleVerifierWindow(): AdjutorixTerminalReleaseCapsuleVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseCapsuleVerifierRuntimeWindow;
}

function adjutorixTerminalReleaseCapsuleVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseCapsuleVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalReleaseCapsuleVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseCapsuleVerifierPath(value: unknown): string {
  const record = adjutorixTerminalReleaseCapsuleVerifierRecord(value);
  return adjutorixTerminalReleaseCapsuleVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalReleaseCapsuleVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseCapsuleVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseCapsuleVerifierRecord(defaults);
    const workspace = adjutorixTerminalReleaseCapsuleVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalReleaseCapsuleVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalReleaseCapsuleVerifierRecord(scanResult);
  const files = adjutorixTerminalReleaseCapsuleVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixTerminalReleaseCapsuleVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-release-capsule"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalReleaseCapsuleVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseCapsuleVerifierValidate(
  capsule: Record<string, unknown>,
  actualVerificationReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalReleaseCapsuleVerifierValidation {
  const failures: string[] = [];
  const verificationReport = adjutorixTerminalReleaseCapsuleVerifierRecord(
    capsule.terminal_control_board_snapshot_verification_report,
  );

  if (capsule.schema !== "adjutorix.ai_runway_terminal_release_capsule.v1") {
    failures.push("schema_mismatch");
  }

  if (capsule.source !== "adjutorix-ai-runway-terminal-release-capsule") {
    failures.push("source_mismatch");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(capsule.capsulated_at)) {
    failures.push("capsulated_at_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(capsule.workspace)) {
    failures.push("workspace_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(capsule.terminal_control_board_snapshot_verification_report_sha256)) {
    failures.push("terminal_control_board_snapshot_verification_report_sha256_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(capsule.mission_snapshot_sha256)) {
    failures.push("mission_snapshot_sha256_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(capsule.mission_control_snapshot_text)) {
    failures.push("mission_control_snapshot_text_missing");
  }

  if (capsule.terminal_control_board_snapshot_verification_report_sha256 !== actualVerificationReportSha256) {
    failures.push("terminal_control_board_snapshot_verification_report_sha256_mismatch");
  }

  if (capsule.mission_snapshot_sha256 !== actualMissionSnapshotSha256) {
    failures.push("mission_snapshot_sha256_mismatch");
  }

  if (verificationReport.schema !== "adjutorix.ai_runway_terminal_control_board_snapshot_verification_report.v1") {
    failures.push("terminal_control_board_snapshot_verification_report_schema_mismatch");
  }

  if (verificationReport.source !== "adjutorix-ai-runway-terminal-control-board-snapshot-verifier") {
    failures.push("terminal_control_board_snapshot_verification_report_source_mismatch");
  }

  if (verificationReport.ok !== true) {
    failures.push("terminal_control_board_snapshot_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(verificationReport.workspace)) {
    failures.push("terminal_control_board_snapshot_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(verificationReport.path)) {
    failures.push("terminal_control_board_snapshot_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleaseCapsuleVerifierString(verificationReport.snapshot_sha256)) {
    failures.push("terminal_control_board_snapshot_verification_report_snapshot_sha256_missing");
  }

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalReleaseCapsuleVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-capsule-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-capsule-verifier";
  panel.className = "adjutorix-ai-runway-terminal-release-capsule-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release capsule verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-capsule-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Capsule Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-release-capsule-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-release-capsule-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-capsule-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Capsules";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Capsule";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-capsule-verifier-output";
  output.textContent = "Terminal release capsule verifier mounted. Scan for capsules.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseCapsuleVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalReleaseCapsuleVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const scanResult = await bridge.scan(workspace);
        const capsules = adjutorixTerminalReleaseCapsuleVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const capsulePath of capsules) {
          const option = document.createElement("option");
          option.value = capsulePath;
          option.textContent = capsulePath;
          select.appendChild(option);
        }

        setState(capsules.length ? "capsules found" : "no capsules");
        setOutput(JSON.stringify({
          ok: true,
          workspace,
          capsule_count: capsules.length,
          capsules,
        }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-capsule-verifier",
          workspace,
          capsule_count: capsules.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE CAPSULE SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseCapsuleVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal release capsule selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalReleaseCapsuleVerifierWorkspace();

        if (!workspace) {
          throw new Error("workspace_not_resolved");
        }

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalReleaseCapsuleVerifierRecord(readResult);
        const content = adjutorixTerminalReleaseCapsuleVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalReleaseCapsuleVerifierRecord(JSON.parse(content));
        const capsuleSha256 = await adjutorixTerminalReleaseCapsuleVerifierSha256(content);

        const verificationReport = adjutorixTerminalReleaseCapsuleVerifierRecord(
          parsed.terminal_control_board_snapshot_verification_report,
        );
        const canonicalVerificationReportText = JSON.stringify(verificationReport, null, 2);
        const actualVerificationReportSha256 = await adjutorixTerminalReleaseCapsuleVerifierSha256(
          canonicalVerificationReportText,
        );

        const missionSnapshotText = adjutorixTerminalReleaseCapsuleVerifierString(
          parsed.mission_control_snapshot_text,
        );
        const missionSnapshotSha256 = await adjutorixTerminalReleaseCapsuleVerifierSha256(
          missionSnapshotText,
        );

        const validation = adjutorixTerminalReleaseCapsuleVerifierValidate(
          parsed,
          actualVerificationReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_release_capsule_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-release-capsule-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          capsule_sha256: capsuleSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_control_board_snapshot_verification_report: {
              ok: parsed.terminal_control_board_snapshot_verification_report_sha256 === actualVerificationReportSha256,
              expected_sha256: parsed.terminal_control_board_snapshot_verification_report_sha256,
              actual_sha256: actualVerificationReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          capsule: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-capsule-verifier",
          workspace,
          path: select.value,
          capsule_sha256: capsuleSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE CAPSULE VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CAPSULE_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-capsule-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_release_capsule.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseCapsuleVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseCapsuleVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_V1
 *
 * Terminal release certificate recorder:
 * - consumes terminal-release-capsule verification report output
 * - validates report schema/source/workspace/path/hash/ok fields
 * - computes SHA-256 over verification report text and mission snapshot text
 * - writes durable terminal release certificate JSON into .adjutorix-ai-runway/
 * - requires manual RELEASE confirmation
 */

interface AdjutorixTerminalReleaseCertificateWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseCertificateRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseCertificateWorkspaceBridge;
}

function adjutorixTerminalReleaseCertificateWindow(): AdjutorixTerminalReleaseCertificateRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseCertificateRuntimeWindow;
}

function adjutorixTerminalReleaseCertificateRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseCertificateString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseCertificateText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleaseCertificateTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleaseCertificateWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseCertificateWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseCertificateRecord(defaults);
    const workspace = adjutorixTerminalReleaseCertificateString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleaseCertificateSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseCertificateParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_release_capsule_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleaseCertificateRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_release_capsule_verification_report.v1") {
    throw new Error("terminal_release_capsule_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-release-capsule-verifier") {
    throw new Error("terminal_release_capsule_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_release_capsule_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleaseCertificateString(parsed.workspace)) {
    throw new Error("terminal_release_capsule_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleaseCertificateString(parsed.path)) {
    throw new Error("terminal_release_capsule_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleaseCertificateString(parsed.capsule_sha256)) {
    throw new Error("terminal_release_capsule_verification_report_capsule_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleaseCertificate(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-certificate")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-certificate";
  panel.className = "adjutorix-ai-runway-terminal-release-certificate";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release certificate");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-certificate-header";

  const title = document.createElement("strong");
  title.textContent = "Release Certificate";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-certificate-confirm";
  confirm.placeholder = "Type RELEASE";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-certificate-note";
  note.placeholder = "Operator terminal release certificate note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-certificate-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Certificate";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Certificate";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Certificate";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-certificate-output";
  output.textContent = "Terminal release certificate mounted. Verify release capsule first, then type RELEASE.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildCertificate(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleaseCertificateWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const verificationText = adjutorixTerminalReleaseCertificateText(
      ".adjutorix-ai-terminal-release-capsule-verifier-output",
    );
    const verificationReport = adjutorixTerminalReleaseCertificateParseReport(verificationText);
    const verificationReportSha256 = await adjutorixTerminalReleaseCertificateSha256(verificationText);
    const missionSnapshotText = adjutorixTerminalReleaseCertificateText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleaseCertificateSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_certificate.v1",
      source: "adjutorix-ai-runway-terminal-release-certificate",
      certified_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_release_capsule_verification_report_sha256: verificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_release_capsule_verification_report: verificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeCertificate(certificate: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleaseCertificateWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleaseCertificateString(certificate.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleaseCertificateTimestamp()}-terminal-release-certificate.json`;
    const content = JSON.stringify(certificate, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const certificate = await buildCertificate();
        setOutput(JSON.stringify(certificate, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-certificate",
          workspace: certificate.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE CERTIFICATE PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "RELEASE") {
        setOutput("Terminal release certificate blocked. Type RELEASE in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const certificate = await buildCertificate();
        const written = await writeCertificate(certificate);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, certificate }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-certificate",
          workspace: certificate.workspace,
          path: written.path,
          bytes: written.bytes,
          certifies: "adjutorix.ai_runway_terminal_release_capsule_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE CERTIFICATE FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-certificate",
    writes: ".adjutorix-ai-runway",
    requires: "manual-release-confirmation",
    certifies: "adjutorix.ai_runway_terminal_release_capsule_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseCertificate, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseCertificate();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_VERIFIER_V1
 *
 * Terminal release certificate verifier:
 * - scans .adjutorix-ai-runway for terminal-release-certificate JSON files
 * - reads selected certificate through Workspace OS
 * - validates certificate schema/source/workspace/report fields
 * - recomputes SHA-256 over certificate content
 * - recomputes embedded terminal-release-capsule verification report hash from canonical JSON
 * - recomputes embedded mission snapshot hash
 * - emits terminal release certificate verification report
 */

interface AdjutorixTerminalReleaseCertificateVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseCertificateVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseCertificateVerifierWorkspaceBridge;
}

interface AdjutorixTerminalReleaseCertificateVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalReleaseCertificateVerifierWindow(): AdjutorixTerminalReleaseCertificateVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseCertificateVerifierRuntimeWindow;
}

function adjutorixTerminalReleaseCertificateVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseCertificateVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalReleaseCertificateVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseCertificateVerifierPath(value: unknown): string {
  const record = adjutorixTerminalReleaseCertificateVerifierRecord(value);
  return adjutorixTerminalReleaseCertificateVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalReleaseCertificateVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseCertificateVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseCertificateVerifierRecord(defaults);
    const workspace = adjutorixTerminalReleaseCertificateVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalReleaseCertificateVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalReleaseCertificateVerifierRecord(scanResult);
  const files = adjutorixTerminalReleaseCertificateVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixTerminalReleaseCertificateVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-release-certificate"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalReleaseCertificateVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseCertificateVerifierValidate(
  certificate: Record<string, unknown>,
  actualCapsuleVerificationReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalReleaseCertificateVerifierValidation {
  const failures: string[] = [];
  const verificationReport = adjutorixTerminalReleaseCertificateVerifierRecord(
    certificate.terminal_release_capsule_verification_report,
  );

  if (certificate.schema !== "adjutorix.ai_runway_terminal_release_certificate.v1") failures.push("schema_mismatch");
  if (certificate.source !== "adjutorix-ai-runway-terminal-release-certificate") failures.push("source_mismatch");
  if (!adjutorixTerminalReleaseCertificateVerifierString(certificate.certified_at)) failures.push("certified_at_missing");
  if (!adjutorixTerminalReleaseCertificateVerifierString(certificate.workspace)) failures.push("workspace_missing");
  if (!adjutorixTerminalReleaseCertificateVerifierString(certificate.terminal_release_capsule_verification_report_sha256)) failures.push("terminal_release_capsule_verification_report_sha256_missing");
  if (!adjutorixTerminalReleaseCertificateVerifierString(certificate.mission_snapshot_sha256)) failures.push("mission_snapshot_sha256_missing");
  if (!adjutorixTerminalReleaseCertificateVerifierString(certificate.mission_control_snapshot_text)) failures.push("mission_control_snapshot_text_missing");
  if (certificate.terminal_release_capsule_verification_report_sha256 !== actualCapsuleVerificationReportSha256) failures.push("terminal_release_capsule_verification_report_sha256_mismatch");
  if (certificate.mission_snapshot_sha256 !== actualMissionSnapshotSha256) failures.push("mission_snapshot_sha256_mismatch");

  if (verificationReport.schema !== "adjutorix.ai_runway_terminal_release_capsule_verification_report.v1") failures.push("terminal_release_capsule_verification_report_schema_mismatch");
  if (verificationReport.source !== "adjutorix-ai-runway-terminal-release-capsule-verifier") failures.push("terminal_release_capsule_verification_report_source_mismatch");
  if (verificationReport.ok !== true) failures.push("terminal_release_capsule_verification_report_not_ok");
  if (!adjutorixTerminalReleaseCertificateVerifierString(verificationReport.workspace)) failures.push("terminal_release_capsule_verification_report_workspace_missing");
  if (!adjutorixTerminalReleaseCertificateVerifierString(verificationReport.path)) failures.push("terminal_release_capsule_verification_report_path_missing");
  if (!adjutorixTerminalReleaseCertificateVerifierString(verificationReport.capsule_sha256)) failures.push("terminal_release_capsule_verification_report_capsule_sha256_missing");

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalReleaseCertificateVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-certificate-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-certificate-verifier";
  panel.className = "adjutorix-ai-runway-terminal-release-certificate-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release certificate verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-certificate-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Certificate Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-release-certificate-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-release-certificate-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-certificate-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Certificates";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Certificate";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-certificate-verifier-output";
  output.textContent = "Terminal release certificate verifier mounted. Scan for certificates.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseCertificateVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalReleaseCertificateVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const scanResult = await bridge.scan(workspace);
        const certificates = adjutorixTerminalReleaseCertificateVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const certificatePath of certificates) {
          const option = document.createElement("option");
          option.value = certificatePath;
          option.textContent = certificatePath;
          select.appendChild(option);
        }

        setState(certificates.length ? "certificates found" : "no certificates");
        setOutput(JSON.stringify({ ok: true, workspace, certificate_count: certificates.length, certificates }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-certificate-verifier",
          workspace,
          certificate_count: certificates.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE CERTIFICATE SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseCertificateVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal release certificate selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalReleaseCertificateVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalReleaseCertificateVerifierRecord(readResult);
        const content = adjutorixTerminalReleaseCertificateVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalReleaseCertificateVerifierRecord(JSON.parse(content));
        const certificateSha256 = await adjutorixTerminalReleaseCertificateVerifierSha256(content);

        const verificationReport = adjutorixTerminalReleaseCertificateVerifierRecord(
          parsed.terminal_release_capsule_verification_report,
        );
        const canonicalVerificationReportText = JSON.stringify(verificationReport, null, 2);
        const actualCapsuleVerificationReportSha256 = await adjutorixTerminalReleaseCertificateVerifierSha256(
          canonicalVerificationReportText,
        );

        const missionSnapshotText = adjutorixTerminalReleaseCertificateVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixTerminalReleaseCertificateVerifierSha256(missionSnapshotText);

        const validation = adjutorixTerminalReleaseCertificateVerifierValidate(
          parsed,
          actualCapsuleVerificationReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_release_certificate_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-release-certificate-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          certificate_sha256: certificateSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_release_capsule_verification_report: {
              ok: parsed.terminal_release_capsule_verification_report_sha256 === actualCapsuleVerificationReportSha256,
              expected_sha256: parsed.terminal_release_capsule_verification_report_sha256,
              actual_sha256: actualCapsuleVerificationReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          certificate: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-certificate-verifier",
          workspace,
          path: select.value,
          certificate_sha256: certificateSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE CERTIFICATE VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_CERTIFICATE_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-certificate-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_release_certificate.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseCertificateVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseCertificateVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_V1
 *
 * Terminal release finality record:
 * - consumes terminal-release-certificate verification report output
 * - validates report schema/source/workspace/path/certificate hash/ok fields
 * - computes SHA-256 over certificate verification report text and mission snapshot text
 * - writes durable terminal release finality record JSON into .adjutorix-ai-runway/
 * - requires manual FINALITY confirmation
 */

interface AdjutorixTerminalReleaseFinalityRecordWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseFinalityRecordRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseFinalityRecordWorkspaceBridge;
}

function adjutorixTerminalReleaseFinalityRecordWindow(): AdjutorixTerminalReleaseFinalityRecordRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseFinalityRecordRuntimeWindow;
}

function adjutorixTerminalReleaseFinalityRecordRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseFinalityRecordString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseFinalityRecordText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleaseFinalityRecordTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleaseFinalityRecordWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseFinalityRecordWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseFinalityRecordRecord(defaults);
    const workspace = adjutorixTerminalReleaseFinalityRecordString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleaseFinalityRecordSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseFinalityRecordParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_release_certificate_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleaseFinalityRecordRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_release_certificate_verification_report.v1") {
    throw new Error("terminal_release_certificate_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-release-certificate-verifier") {
    throw new Error("terminal_release_certificate_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_release_certificate_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleaseFinalityRecordString(parsed.workspace)) {
    throw new Error("terminal_release_certificate_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleaseFinalityRecordString(parsed.path)) {
    throw new Error("terminal_release_certificate_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleaseFinalityRecordString(parsed.certificate_sha256)) {
    throw new Error("terminal_release_certificate_verification_report_certificate_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleaseFinalityRecord(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-finality-record")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-finality-record";
  panel.className = "adjutorix-ai-runway-terminal-release-finality-record";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release finality record");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-finality-record-header";

  const title = document.createElement("strong");
  title.textContent = "Release Finality";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-finality-record-confirm";
  confirm.placeholder = "Type FINALITY";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-finality-record-note";
  note.placeholder = "Operator terminal release finality note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-finality-record-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Finality";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Finality";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Finality";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-finality-record-output";
  output.textContent = "Terminal release finality mounted. Verify release certificate first, then type FINALITY.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildFinalityRecord(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleaseFinalityRecordWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const certificateVerificationText = adjutorixTerminalReleaseFinalityRecordText(
      ".adjutorix-ai-terminal-release-certificate-verifier-output",
    );
    const certificateVerificationReport = adjutorixTerminalReleaseFinalityRecordParseReport(
      certificateVerificationText,
    );
    const certificateVerificationReportSha256 = await adjutorixTerminalReleaseFinalityRecordSha256(
      certificateVerificationText,
    );
    const missionSnapshotText = adjutorixTerminalReleaseFinalityRecordText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleaseFinalityRecordSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_finality_record.v1",
      source: "adjutorix-ai-runway-terminal-release-finality-record",
      finalized_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_release_certificate_verification_report_sha256: certificateVerificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_release_certificate_verification_report: certificateVerificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeFinalityRecord(record: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleaseFinalityRecordWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleaseFinalityRecordString(record.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleaseFinalityRecordTimestamp()}-terminal-release-finality-record.json`;
    const content = JSON.stringify(record, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const record = await buildFinalityRecord();
        setOutput(JSON.stringify(record, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-finality-record",
          workspace: record.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE FINALITY PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "FINALITY") {
        setOutput("Terminal release finality blocked. Type FINALITY in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const record = await buildFinalityRecord();
        const written = await writeFinalityRecord(record);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, finality_record: record }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-finality-record",
          workspace: record.workspace,
          path: written.path,
          bytes: written.bytes,
          finalizes: "adjutorix.ai_runway_terminal_release_certificate_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE FINALITY FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-finality-record",
    writes: ".adjutorix-ai-runway",
    requires: "manual-finality-confirmation",
    finalizes: "adjutorix.ai_runway_terminal_release_certificate_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseFinalityRecord, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseFinalityRecord();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_VERIFIER_V1
 *
 * Terminal release finality record verifier:
 * - scans .adjutorix-ai-runway for terminal-release-finality-record JSON files
 * - reads selected finality record through Workspace OS
 * - validates finality schema/source/workspace/hash/report fields
 * - recomputes SHA-256 over finality record content, embedded certificate verification report, and mission snapshot
 * - emits terminal release finality verification report
 */

interface AdjutorixTerminalReleaseFinalityRecordVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseFinalityRecordVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseFinalityRecordVerifierWorkspaceBridge;
}

interface AdjutorixTerminalReleaseFinalityRecordVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalReleaseFinalityRecordVerifierWindow(): AdjutorixTerminalReleaseFinalityRecordVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseFinalityRecordVerifierRuntimeWindow;
}

function adjutorixTerminalReleaseFinalityRecordVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseFinalityRecordVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalReleaseFinalityRecordVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseFinalityRecordVerifierPath(value: unknown): string {
  const record = adjutorixTerminalReleaseFinalityRecordVerifierRecord(value);
  return adjutorixTerminalReleaseFinalityRecordVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalReleaseFinalityRecordVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseFinalityRecordVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseFinalityRecordVerifierRecord(defaults);
    const workspace = adjutorixTerminalReleaseFinalityRecordVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalReleaseFinalityRecordVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalReleaseFinalityRecordVerifierRecord(scanResult);
  const files = adjutorixTerminalReleaseFinalityRecordVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixTerminalReleaseFinalityRecordVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-release-finality-record"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalReleaseFinalityRecordVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseFinalityRecordVerifierValidate(
  finalityRecord: Record<string, unknown>,
  actualCertificateVerificationReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalReleaseFinalityRecordVerifierValidation {
  const failures: string[] = [];
  const certificateVerificationReport = adjutorixTerminalReleaseFinalityRecordVerifierRecord(
    finalityRecord.terminal_release_certificate_verification_report,
  );

  if (finalityRecord.schema !== "adjutorix.ai_runway_terminal_release_finality_record.v1") failures.push("schema_mismatch");
  if (finalityRecord.source !== "adjutorix-ai-runway-terminal-release-finality-record") failures.push("source_mismatch");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(finalityRecord.finalized_at)) failures.push("finalized_at_missing");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(finalityRecord.workspace)) failures.push("workspace_missing");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(finalityRecord.terminal_release_certificate_verification_report_sha256)) failures.push("terminal_release_certificate_verification_report_sha256_missing");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(finalityRecord.mission_snapshot_sha256)) failures.push("mission_snapshot_sha256_missing");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(finalityRecord.mission_control_snapshot_text)) failures.push("mission_control_snapshot_text_missing");
  if (finalityRecord.terminal_release_certificate_verification_report_sha256 !== actualCertificateVerificationReportSha256) failures.push("terminal_release_certificate_verification_report_sha256_mismatch");
  if (finalityRecord.mission_snapshot_sha256 !== actualMissionSnapshotSha256) failures.push("mission_snapshot_sha256_mismatch");

  if (certificateVerificationReport.schema !== "adjutorix.ai_runway_terminal_release_certificate_verification_report.v1") failures.push("terminal_release_certificate_verification_report_schema_mismatch");
  if (certificateVerificationReport.source !== "adjutorix-ai-runway-terminal-release-certificate-verifier") failures.push("terminal_release_certificate_verification_report_source_mismatch");
  if (certificateVerificationReport.ok !== true) failures.push("terminal_release_certificate_verification_report_not_ok");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(certificateVerificationReport.workspace)) failures.push("terminal_release_certificate_verification_report_workspace_missing");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(certificateVerificationReport.path)) failures.push("terminal_release_certificate_verification_report_path_missing");
  if (!adjutorixTerminalReleaseFinalityRecordVerifierString(certificateVerificationReport.certificate_sha256)) failures.push("terminal_release_certificate_verification_report_certificate_sha256_missing");

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalReleaseFinalityRecordVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-finality-record-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-finality-record-verifier";
  panel.className = "adjutorix-ai-runway-terminal-release-finality-record-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release finality record verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-finality-record-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Finality Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-release-finality-record-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-release-finality-record-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-finality-record-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Finality";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Finality";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-finality-record-verifier-output";
  output.textContent = "Terminal release finality record verifier mounted. Scan for finality records.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseFinalityRecordVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalReleaseFinalityRecordVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const scanResult = await bridge.scan(workspace);
        const finalityRecords = adjutorixTerminalReleaseFinalityRecordVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const finalityPath of finalityRecords) {
          const option = document.createElement("option");
          option.value = finalityPath;
          option.textContent = finalityPath;
          select.appendChild(option);
        }

        setState(finalityRecords.length ? "records found" : "no records");
        setOutput(JSON.stringify({ ok: true, workspace, finality_record_count: finalityRecords.length, finality_records: finalityRecords }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-finality-record-verifier",
          workspace,
          finality_record_count: finalityRecords.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE FINALITY RECORD SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseFinalityRecordVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal release finality record selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalReleaseFinalityRecordVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalReleaseFinalityRecordVerifierRecord(readResult);
        const content = adjutorixTerminalReleaseFinalityRecordVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalReleaseFinalityRecordVerifierRecord(JSON.parse(content));
        const finalityRecordSha256 = await adjutorixTerminalReleaseFinalityRecordVerifierSha256(content);

        const certificateVerificationReport = adjutorixTerminalReleaseFinalityRecordVerifierRecord(
          parsed.terminal_release_certificate_verification_report,
        );
        const canonicalCertificateVerificationReportText = JSON.stringify(certificateVerificationReport, null, 2);
        const actualCertificateVerificationReportSha256 = await adjutorixTerminalReleaseFinalityRecordVerifierSha256(
          canonicalCertificateVerificationReportText,
        );

        const missionSnapshotText = adjutorixTerminalReleaseFinalityRecordVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixTerminalReleaseFinalityRecordVerifierSha256(missionSnapshotText);

        const validation = adjutorixTerminalReleaseFinalityRecordVerifierValidate(
          parsed,
          actualCertificateVerificationReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_release_finality_record_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-release-finality-record-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          finality_record_sha256: finalityRecordSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_release_certificate_verification_report: {
              ok: parsed.terminal_release_certificate_verification_report_sha256 === actualCertificateVerificationReportSha256,
              expected_sha256: parsed.terminal_release_certificate_verification_report_sha256,
              actual_sha256: actualCertificateVerificationReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          finality_record: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-finality-record-verifier",
          workspace,
          path: select.value,
          finality_record_sha256: finalityRecordSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE FINALITY RECORD VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_FINALITY_RECORD_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-finality-record-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_release_finality_record.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseFinalityRecordVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseFinalityRecordVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_V1
 *
 * Terminal release archive seal:
 * - consumes terminal-release-finality-record verification report output
 * - validates report schema/source/workspace/path/finality hash/ok fields
 * - computes SHA-256 over finality verification report text and mission snapshot text
 * - writes durable terminal release archive seal JSON into .adjutorix-ai-runway/
 * - requires manual ARCHIVE confirmation
 */

interface AdjutorixTerminalReleaseArchiveSealWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseArchiveSealRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseArchiveSealWorkspaceBridge;
}

function adjutorixTerminalReleaseArchiveSealWindow(): AdjutorixTerminalReleaseArchiveSealRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseArchiveSealRuntimeWindow;
}

function adjutorixTerminalReleaseArchiveSealRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseArchiveSealString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseArchiveSealText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleaseArchiveSealTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleaseArchiveSealWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseArchiveSealWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseArchiveSealRecord(defaults);
    const workspace = adjutorixTerminalReleaseArchiveSealString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleaseArchiveSealSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseArchiveSealParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_release_finality_record_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleaseArchiveSealRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_release_finality_record_verification_report.v1") {
    throw new Error("terminal_release_finality_record_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-release-finality-record-verifier") {
    throw new Error("terminal_release_finality_record_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_release_finality_record_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleaseArchiveSealString(parsed.workspace)) {
    throw new Error("terminal_release_finality_record_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleaseArchiveSealString(parsed.path)) {
    throw new Error("terminal_release_finality_record_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleaseArchiveSealString(parsed.finality_record_sha256)) {
    throw new Error("terminal_release_finality_record_verification_report_finality_record_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleaseArchiveSeal(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-archive-seal")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-archive-seal";
  panel.className = "adjutorix-ai-runway-terminal-release-archive-seal";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release archive seal");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-archive-seal-header";

  const title = document.createElement("strong");
  title.textContent = "Archive Seal";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-archive-seal-confirm";
  confirm.placeholder = "Type ARCHIVE";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-archive-seal-note";
  note.placeholder = "Operator terminal release archive seal note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-archive-seal-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Archive";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Archive";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Archive";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-archive-seal-output";
  output.textContent = "Terminal release archive seal mounted. Verify finality record first, then type ARCHIVE.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildArchiveSeal(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleaseArchiveSealWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const finalityVerificationText = adjutorixTerminalReleaseArchiveSealText(
      ".adjutorix-ai-terminal-release-finality-record-verifier-output",
    );
    const finalityVerificationReport = adjutorixTerminalReleaseArchiveSealParseReport(finalityVerificationText);
    const finalityVerificationReportSha256 = await adjutorixTerminalReleaseArchiveSealSha256(finalityVerificationText);
    const missionSnapshotText = adjutorixTerminalReleaseArchiveSealText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleaseArchiveSealSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_archive_seal.v1",
      source: "adjutorix-ai-runway-terminal-release-archive-seal",
      archived_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_release_finality_record_verification_report_sha256: finalityVerificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_release_finality_record_verification_report: finalityVerificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeArchiveSeal(record: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleaseArchiveSealWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleaseArchiveSealString(record.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleaseArchiveSealTimestamp()}-terminal-release-archive-seal.json`;
    const content = JSON.stringify(record, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const record = await buildArchiveSeal();
        setOutput(JSON.stringify(record, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-seal",
          workspace: record.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE ARCHIVE SEAL PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "ARCHIVE") {
        setOutput("Terminal release archive seal blocked. Type ARCHIVE in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const record = await buildArchiveSeal();
        const written = await writeArchiveSeal(record);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, archive_seal: record }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-seal",
          workspace: record.workspace,
          path: written.path,
          bytes: written.bytes,
          archives: "adjutorix.ai_runway_terminal_release_finality_record_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE ARCHIVE SEAL FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-archive-seal",
    writes: ".adjutorix-ai-runway",
    requires: "manual-archive-confirmation",
    archives: "adjutorix.ai_runway_terminal_release_finality_record_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseArchiveSeal, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseArchiveSeal();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_VERIFIER_V1
 *
 * Terminal release archive seal verifier:
 * - scans .adjutorix-ai-runway for terminal-release-archive-seal JSON files
 * - reads selected archive seal through Workspace OS
 * - validates archive schema/source/workspace/hash/report fields
 * - recomputes SHA-256 over archive seal content, embedded finality verification report, and mission snapshot
 * - emits terminal release archive seal verification report
 */

interface AdjutorixTerminalReleaseArchiveSealVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseArchiveSealVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseArchiveSealVerifierWorkspaceBridge;
}

interface AdjutorixTerminalReleaseArchiveSealVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalReleaseArchiveSealVerifierWindow(): AdjutorixTerminalReleaseArchiveSealVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseArchiveSealVerifierRuntimeWindow;
}

function adjutorixTerminalReleaseArchiveSealVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseArchiveSealVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalReleaseArchiveSealVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseArchiveSealVerifierPath(value: unknown): string {
  const record = adjutorixTerminalReleaseArchiveSealVerifierRecord(value);
  return adjutorixTerminalReleaseArchiveSealVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalReleaseArchiveSealVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseArchiveSealVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseArchiveSealVerifierRecord(defaults);
    const workspace = adjutorixTerminalReleaseArchiveSealVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalReleaseArchiveSealVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalReleaseArchiveSealVerifierRecord(scanResult);
  const files = adjutorixTerminalReleaseArchiveSealVerifierArray(record.files || record.entries || record.items);

  return files
    .map(adjutorixTerminalReleaseArchiveSealVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-release-archive-seal"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalReleaseArchiveSealVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseArchiveSealVerifierValidate(
  archiveSeal: Record<string, unknown>,
  actualFinalityVerificationReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalReleaseArchiveSealVerifierValidation {
  const failures: string[] = [];
  const finalityVerificationReport = adjutorixTerminalReleaseArchiveSealVerifierRecord(
    archiveSeal.terminal_release_finality_record_verification_report,
  );

  if (archiveSeal.schema !== "adjutorix.ai_runway_terminal_release_archive_seal.v1") failures.push("schema_mismatch");
  if (archiveSeal.source !== "adjutorix-ai-runway-terminal-release-archive-seal") failures.push("source_mismatch");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(archiveSeal.archived_at)) failures.push("archived_at_missing");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(archiveSeal.workspace)) failures.push("workspace_missing");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(archiveSeal.terminal_release_finality_record_verification_report_sha256)) failures.push("terminal_release_finality_record_verification_report_sha256_missing");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(archiveSeal.mission_snapshot_sha256)) failures.push("mission_snapshot_sha256_missing");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(archiveSeal.mission_control_snapshot_text)) failures.push("mission_control_snapshot_text_missing");
  if (archiveSeal.terminal_release_finality_record_verification_report_sha256 !== actualFinalityVerificationReportSha256) failures.push("terminal_release_finality_record_verification_report_sha256_mismatch");
  if (archiveSeal.mission_snapshot_sha256 !== actualMissionSnapshotSha256) failures.push("mission_snapshot_sha256_mismatch");

  if (finalityVerificationReport.schema !== "adjutorix.ai_runway_terminal_release_finality_record_verification_report.v1") failures.push("terminal_release_finality_record_verification_report_schema_mismatch");
  if (finalityVerificationReport.source !== "adjutorix-ai-runway-terminal-release-finality-record-verifier") failures.push("terminal_release_finality_record_verification_report_source_mismatch");
  if (finalityVerificationReport.ok !== true) failures.push("terminal_release_finality_record_verification_report_not_ok");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(finalityVerificationReport.workspace)) failures.push("terminal_release_finality_record_verification_report_workspace_missing");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(finalityVerificationReport.path)) failures.push("terminal_release_finality_record_verification_report_path_missing");
  if (!adjutorixTerminalReleaseArchiveSealVerifierString(finalityVerificationReport.finality_record_sha256)) failures.push("terminal_release_finality_record_verification_report_finality_record_sha256_missing");

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalReleaseArchiveSealVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-archive-seal-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-archive-seal-verifier";
  panel.className = "adjutorix-ai-runway-terminal-release-archive-seal-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release archive seal verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-archive-seal-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Archive Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-release-archive-seal-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-release-archive-seal-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-archive-seal-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Archives";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Archive";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-archive-seal-verifier-output";
  output.textContent = "Terminal release archive seal verifier mounted. Scan for archive seals.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseArchiveSealVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalReleaseArchiveSealVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const scanResult = await bridge.scan(workspace);
        const archiveSeals = adjutorixTerminalReleaseArchiveSealVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const archivePath of archiveSeals) {
          const option = document.createElement("option");
          option.value = archivePath;
          option.textContent = archivePath;
          select.appendChild(option);
        }

        setState(archiveSeals.length ? "seals found" : "no seals");
        setOutput(JSON.stringify({ ok: true, workspace, archive_seal_count: archiveSeals.length, archive_seals: archiveSeals }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-seal-verifier",
          workspace,
          archive_seal_count: archiveSeals.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE ARCHIVE SEAL SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseArchiveSealVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal release archive seal selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalReleaseArchiveSealVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalReleaseArchiveSealVerifierRecord(readResult);
        const content = adjutorixTerminalReleaseArchiveSealVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalReleaseArchiveSealVerifierRecord(JSON.parse(content));
        const archiveSealSha256 = await adjutorixTerminalReleaseArchiveSealVerifierSha256(content);

        const finalityVerificationReport = adjutorixTerminalReleaseArchiveSealVerifierRecord(
          parsed.terminal_release_finality_record_verification_report,
        );
        const canonicalFinalityVerificationReportText = JSON.stringify(finalityVerificationReport, null, 2);
        const actualFinalityVerificationReportSha256 = await adjutorixTerminalReleaseArchiveSealVerifierSha256(
          canonicalFinalityVerificationReportText,
        );

        const missionSnapshotText = adjutorixTerminalReleaseArchiveSealVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixTerminalReleaseArchiveSealVerifierSha256(missionSnapshotText);

        const validation = adjutorixTerminalReleaseArchiveSealVerifierValidate(
          parsed,
          actualFinalityVerificationReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_release_archive_seal_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-release-archive-seal-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          archive_seal_sha256: archiveSealSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_release_finality_record_verification_report: {
              ok: parsed.terminal_release_finality_record_verification_report_sha256 === actualFinalityVerificationReportSha256,
              expected_sha256: parsed.terminal_release_finality_record_verification_report_sha256,
              actual_sha256: actualFinalityVerificationReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          archive_seal: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-seal-verifier",
          workspace,
          path: select.value,
          archive_seal_sha256: archiveSealSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE ARCHIVE SEAL VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_SEAL_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-archive-seal-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_release_archive_seal.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseArchiveSealVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseArchiveSealVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_V1
 *
 * Terminal release archive bundle:
 * - consumes terminal-release-archive-seal verification report output
 * - validates report schema/source/workspace/path/archive hash/ok fields
 * - computes SHA-256 over archive seal verification report text and mission snapshot text
 * - writes durable terminal release archive bundle JSON into .adjutorix-ai-runway/
 * - requires manual BUNDLE confirmation
 */

interface AdjutorixTerminalReleaseArchiveBundleWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseArchiveBundleRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseArchiveBundleWorkspaceBridge;
}

function adjutorixTerminalReleaseArchiveBundleWindow(): AdjutorixTerminalReleaseArchiveBundleRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseArchiveBundleRuntimeWindow;
}

function adjutorixTerminalReleaseArchiveBundleRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseArchiveBundleString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseArchiveBundleText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleaseArchiveBundleTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleaseArchiveBundleWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseArchiveBundleWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseArchiveBundleRecord(defaults);
    const workspace = adjutorixTerminalReleaseArchiveBundleString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleaseArchiveBundleSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseArchiveBundleParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_release_archive_seal_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleaseArchiveBundleRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_release_archive_seal_verification_report.v1") {
    throw new Error("terminal_release_archive_seal_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-release-archive-seal-verifier") {
    throw new Error("terminal_release_archive_seal_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_release_archive_seal_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleaseArchiveBundleString(parsed.workspace)) {
    throw new Error("terminal_release_archive_seal_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleaseArchiveBundleString(parsed.path)) {
    throw new Error("terminal_release_archive_seal_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleaseArchiveBundleString(parsed.archive_seal_sha256)) {
    throw new Error("terminal_release_archive_seal_verification_report_archive_seal_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleaseArchiveBundle(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-archive-bundle")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-archive-bundle";
  panel.className = "adjutorix-ai-runway-terminal-release-archive-bundle";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release archive bundle");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-archive-bundle-header";

  const title = document.createElement("strong");
  title.textContent = "Archive Bundle";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-archive-bundle-confirm";
  confirm.placeholder = "Type BUNDLE";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-archive-bundle-note";
  note.placeholder = "Operator terminal release archive bundle note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-archive-bundle-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Bundle";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Bundle";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Bundle";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-archive-bundle-output";
  output.textContent = "Terminal release archive bundle mounted. Verify archive seal first, then type BUNDLE.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildArchiveBundle(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleaseArchiveBundleWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const archiveSealVerificationText = adjutorixTerminalReleaseArchiveBundleText(
      ".adjutorix-ai-terminal-release-archive-seal-verifier-output",
    );
    const archiveSealVerificationReport = adjutorixTerminalReleaseArchiveBundleParseReport(archiveSealVerificationText);
    const archiveSealVerificationReportSha256 = await adjutorixTerminalReleaseArchiveBundleSha256(
      archiveSealVerificationText,
    );
    const missionSnapshotText = adjutorixTerminalReleaseArchiveBundleText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleaseArchiveBundleSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_archive_bundle.v1",
      source: "adjutorix-ai-runway-terminal-release-archive-bundle",
      bundled_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_release_archive_seal_verification_report_sha256: archiveSealVerificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_release_archive_seal_verification_report: archiveSealVerificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writeArchiveBundle(record: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleaseArchiveBundleWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleaseArchiveBundleString(record.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleaseArchiveBundleTimestamp()}-terminal-release-archive-bundle.json`;
    const content = JSON.stringify(record, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const record = await buildArchiveBundle();
        setOutput(JSON.stringify(record, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-bundle",
          workspace: record.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE ARCHIVE BUNDLE PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "BUNDLE") {
        setOutput("Terminal release archive bundle blocked. Type BUNDLE in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const record = await buildArchiveBundle();
        const written = await writeArchiveBundle(record);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, archive_bundle: record }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-bundle",
          workspace: record.workspace,
          path: written.path,
          bytes: written.bytes,
          bundles: "adjutorix.ai_runway_terminal_release_archive_seal_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE ARCHIVE BUNDLE FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-archive-bundle",
    writes: ".adjutorix-ai-runway",
    requires: "manual-bundle-confirmation",
    bundles: "adjutorix.ai_runway_terminal_release_archive_seal_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseArchiveBundle, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseArchiveBundle();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_VERIFIER_V1
 *
 * Terminal release archive bundle verifier:
 * - scans .adjutorix-ai-runway for terminal-release-archive-bundle JSON files
 * - reads selected archive bundle through Workspace OS
 * - validates bundle schema/source/workspace/hash/report fields
 * - recomputes SHA-256 over archive bundle content, embedded archive seal verification report, and mission snapshot
 * - emits terminal release archive bundle verification report
 */

interface AdjutorixTerminalReleaseArchiveBundleVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleaseArchiveBundleVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleaseArchiveBundleVerifierWorkspaceBridge;
}

interface AdjutorixTerminalReleaseArchiveBundleVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalReleaseArchiveBundleVerifierWindow(): AdjutorixTerminalReleaseArchiveBundleVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleaseArchiveBundleVerifierRuntimeWindow;
}

function adjutorixTerminalReleaseArchiveBundleVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleaseArchiveBundleVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalReleaseArchiveBundleVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleaseArchiveBundleVerifierPath(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const record = adjutorixTerminalReleaseArchiveBundleVerifierRecord(value);
  return adjutorixTerminalReleaseArchiveBundleVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalReleaseArchiveBundleVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleaseArchiveBundleVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleaseArchiveBundleVerifierRecord(defaults);
    const workspace = adjutorixTerminalReleaseArchiveBundleVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalReleaseArchiveBundleVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalReleaseArchiveBundleVerifierRecord(scanResult);
  const files = Array.isArray(scanResult)
    ? scanResult
    : adjutorixTerminalReleaseArchiveBundleVerifierArray(record.files || record.entries || record.items || record.paths);

  return files
    .map(adjutorixTerminalReleaseArchiveBundleVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-release-archive-bundle"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalReleaseArchiveBundleVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleaseArchiveBundleVerifierValidate(
  archiveBundle: Record<string, unknown>,
  actualArchiveSealVerificationReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalReleaseArchiveBundleVerifierValidation {
  const failures: string[] = [];
  const archiveSealVerificationReport = adjutorixTerminalReleaseArchiveBundleVerifierRecord(
    archiveBundle.terminal_release_archive_seal_verification_report,
  );

  if (archiveBundle.schema !== "adjutorix.ai_runway_terminal_release_archive_bundle.v1") failures.push("schema_mismatch");
  if (archiveBundle.source !== "adjutorix-ai-runway-terminal-release-archive-bundle") failures.push("source_mismatch");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveBundle.bundled_at)) failures.push("bundled_at_missing");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveBundle.workspace)) failures.push("workspace_missing");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveBundle.terminal_release_archive_seal_verification_report_sha256)) failures.push("terminal_release_archive_seal_verification_report_sha256_missing");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveBundle.mission_snapshot_sha256)) failures.push("mission_snapshot_sha256_missing");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveBundle.mission_control_snapshot_text)) failures.push("mission_control_snapshot_text_missing");
  if (archiveBundle.terminal_release_archive_seal_verification_report_sha256 !== actualArchiveSealVerificationReportSha256) failures.push("terminal_release_archive_seal_verification_report_sha256_mismatch");
  if (archiveBundle.mission_snapshot_sha256 !== actualMissionSnapshotSha256) failures.push("mission_snapshot_sha256_mismatch");

  if (archiveSealVerificationReport.schema !== "adjutorix.ai_runway_terminal_release_archive_seal_verification_report.v1") failures.push("terminal_release_archive_seal_verification_report_schema_mismatch");
  if (archiveSealVerificationReport.source !== "adjutorix-ai-runway-terminal-release-archive-seal-verifier") failures.push("terminal_release_archive_seal_verification_report_source_mismatch");
  if (archiveSealVerificationReport.ok !== true) failures.push("terminal_release_archive_seal_verification_report_not_ok");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveSealVerificationReport.workspace)) failures.push("terminal_release_archive_seal_verification_report_workspace_missing");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveSealVerificationReport.path)) failures.push("terminal_release_archive_seal_verification_report_path_missing");
  if (!adjutorixTerminalReleaseArchiveBundleVerifierString(archiveSealVerificationReport.archive_seal_sha256)) failures.push("terminal_release_archive_seal_verification_report_archive_seal_sha256_missing");

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalReleaseArchiveBundleVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-archive-bundle-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-archive-bundle-verifier";
  panel.className = "adjutorix-ai-runway-terminal-release-archive-bundle-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release archive bundle verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-archive-bundle-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Bundle Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-release-archive-bundle-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-release-archive-bundle-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-archive-bundle-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Bundles";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Bundle";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-archive-bundle-verifier-output";
  output.textContent = "Terminal release archive bundle verifier mounted. Scan for archive bundles.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseArchiveBundleVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalReleaseArchiveBundleVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const scanResult = await bridge.scan(workspace);
        const archiveBundles = adjutorixTerminalReleaseArchiveBundleVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const bundlePath of archiveBundles) {
          const option = document.createElement("option");
          option.value = bundlePath;
          option.textContent = bundlePath;
          select.appendChild(option);
        }

        setState(archiveBundles.length ? "bundles found" : "no bundles");
        setOutput(JSON.stringify({ ok: true, workspace, archive_bundle_count: archiveBundles.length, archive_bundles: archiveBundles }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-bundle-verifier",
          workspace,
          archive_bundle_count: archiveBundles.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE ARCHIVE BUNDLE SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleaseArchiveBundleVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal release archive bundle selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalReleaseArchiveBundleVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalReleaseArchiveBundleVerifierRecord(readResult);
        const content = adjutorixTerminalReleaseArchiveBundleVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalReleaseArchiveBundleVerifierRecord(JSON.parse(content));
        const archiveBundleSha256 = await adjutorixTerminalReleaseArchiveBundleVerifierSha256(content);

        const archiveSealVerificationReport = adjutorixTerminalReleaseArchiveBundleVerifierRecord(
          parsed.terminal_release_archive_seal_verification_report,
        );
        const canonicalArchiveSealVerificationReportText = JSON.stringify(archiveSealVerificationReport, null, 2);
        const actualArchiveSealVerificationReportSha256 = await adjutorixTerminalReleaseArchiveBundleVerifierSha256(
          canonicalArchiveSealVerificationReportText,
        );

        const missionSnapshotText = adjutorixTerminalReleaseArchiveBundleVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixTerminalReleaseArchiveBundleVerifierSha256(missionSnapshotText);

        const validation = adjutorixTerminalReleaseArchiveBundleVerifierValidate(
          parsed,
          actualArchiveSealVerificationReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_release_archive_bundle_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-release-archive-bundle-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          archive_bundle_sha256: archiveBundleSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_release_archive_seal_verification_report: {
              ok: parsed.terminal_release_archive_seal_verification_report_sha256 === actualArchiveSealVerificationReportSha256,
              expected_sha256: parsed.terminal_release_archive_seal_verification_report_sha256,
              actual_sha256: actualArchiveSealVerificationReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          archive_bundle: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-archive-bundle-verifier",
          workspace,
          path: select.value,
          archive_bundle_sha256: archiveBundleSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE ARCHIVE BUNDLE VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_ARCHIVE_BUNDLE_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-archive-bundle-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_release_archive_bundle.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleaseArchiveBundleVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleaseArchiveBundleVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_V1
 *
 * Terminal release publication manifest:
 * - consumes terminal-release-archive-bundle verification report output
 * - validates report schema/source/workspace/path/archive bundle hash/ok fields
 * - computes SHA-256 over archive bundle verification report text and mission snapshot text
 * - writes durable terminal release publication manifest JSON into .adjutorix-ai-runway/
 * - requires manual PUBLISH confirmation
 */

interface AdjutorixTerminalReleasePublicationManifestWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleasePublicationManifestRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleasePublicationManifestWorkspaceBridge;
}

function adjutorixTerminalReleasePublicationManifestWindow(): AdjutorixTerminalReleasePublicationManifestRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleasePublicationManifestRuntimeWindow;
}

function adjutorixTerminalReleasePublicationManifestRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleasePublicationManifestString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleasePublicationManifestText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleasePublicationManifestTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleasePublicationManifestWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleasePublicationManifestWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleasePublicationManifestRecord(defaults);
    const workspace = adjutorixTerminalReleasePublicationManifestString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleasePublicationManifestSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleasePublicationManifestParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_release_archive_bundle_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleasePublicationManifestRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_release_archive_bundle_verification_report.v1") {
    throw new Error("terminal_release_archive_bundle_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-release-archive-bundle-verifier") {
    throw new Error("terminal_release_archive_bundle_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_release_archive_bundle_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleasePublicationManifestString(parsed.workspace)) {
    throw new Error("terminal_release_archive_bundle_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleasePublicationManifestString(parsed.path)) {
    throw new Error("terminal_release_archive_bundle_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleasePublicationManifestString(parsed.archive_bundle_sha256)) {
    throw new Error("terminal_release_archive_bundle_verification_report_archive_bundle_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleasePublicationManifest(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-publication-manifest")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-publication-manifest";
  panel.className = "adjutorix-ai-runway-terminal-release-publication-manifest";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release publication manifest");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-publication-manifest-header";

  const title = document.createElement("strong");
  title.textContent = "Publication Manifest";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-publication-manifest-confirm";
  confirm.placeholder = "Type PUBLISH";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-publication-manifest-note";
  note.placeholder = "Operator terminal release publication manifest note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-publication-manifest-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Publish";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Publish";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Publish";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-publication-manifest-output";
  output.textContent = "Terminal release publication manifest mounted. Verify archive bundle first, then type PUBLISH.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildPublicationManifest(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleasePublicationManifestWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const archiveBundleVerificationText = adjutorixTerminalReleasePublicationManifestText(
      ".adjutorix-ai-terminal-release-archive-bundle-verifier-output",
    );
    const archiveBundleVerificationReport = adjutorixTerminalReleasePublicationManifestParseReport(
      archiveBundleVerificationText,
    );
    const archiveBundleVerificationReportSha256 = await adjutorixTerminalReleasePublicationManifestSha256(
      archiveBundleVerificationText,
    );
    const missionSnapshotText = adjutorixTerminalReleasePublicationManifestText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleasePublicationManifestSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_publication_manifest.v1",
      source: "adjutorix-ai-runway-terminal-release-publication-manifest",
      published_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_release_archive_bundle_verification_report_sha256: archiveBundleVerificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_release_archive_bundle_verification_report: archiveBundleVerificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writePublicationManifest(record: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleasePublicationManifestWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleasePublicationManifestString(record.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleasePublicationManifestTimestamp()}-terminal-release-publication-manifest.json`;
    const content = JSON.stringify(record, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const record = await buildPublicationManifest();
        setOutput(JSON.stringify(record, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-publication-manifest",
          workspace: record.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE PUBLICATION MANIFEST PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "PUBLISH") {
        setOutput("Terminal release publication manifest blocked. Type PUBLISH in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const record = await buildPublicationManifest();
        const written = await writePublicationManifest(record);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, publication_manifest: record }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-publication-manifest",
          workspace: record.workspace,
          path: written.path,
          bytes: written.bytes,
          publishes: "adjutorix.ai_runway_terminal_release_archive_bundle_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE PUBLICATION MANIFEST FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-publication-manifest",
    writes: ".adjutorix-ai-runway",
    requires: "manual-publish-confirmation",
    publishes: "adjutorix.ai_runway_terminal_release_archive_bundle_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleasePublicationManifest, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleasePublicationManifest();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_VERIFIER_V1
 *
 * Terminal release publication manifest verifier:
 * - scans .adjutorix-ai-runway for terminal-release-publication-manifest JSON files
 * - reads selected publication manifest through Workspace OS
 * - validates publication schema/source/workspace/hash/report fields
 * - recomputes SHA-256 over publication manifest content, embedded archive bundle verification report, and mission snapshot
 * - emits terminal release publication manifest verification report
 */

interface AdjutorixTerminalReleasePublicationManifestVerifierWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  scan?: (workspace: string) => Promise<unknown>;
  readText?: (request: { workspace?: string; path: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleasePublicationManifestVerifierRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleasePublicationManifestVerifierWorkspaceBridge;
}

interface AdjutorixTerminalReleasePublicationManifestVerifierValidation {
  ok: boolean;
  failures: string[];
}

function adjutorixTerminalReleasePublicationManifestVerifierWindow(): AdjutorixTerminalReleasePublicationManifestVerifierRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleasePublicationManifestVerifierRuntimeWindow;
}

function adjutorixTerminalReleasePublicationManifestVerifierRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleasePublicationManifestVerifierArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function adjutorixTerminalReleasePublicationManifestVerifierString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleasePublicationManifestVerifierPath(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const record = adjutorixTerminalReleasePublicationManifestVerifierRecord(value);
  return adjutorixTerminalReleasePublicationManifestVerifierString(
    record.path || record.relativePath || record.file || record.name,
  );
}

async function adjutorixTerminalReleasePublicationManifestVerifierWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleasePublicationManifestVerifierWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleasePublicationManifestVerifierRecord(defaults);
    const workspace = adjutorixTerminalReleasePublicationManifestVerifierString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

function adjutorixTerminalReleasePublicationManifestVerifierFilesFromScan(scanResult: unknown): string[] {
  const record = adjutorixTerminalReleasePublicationManifestVerifierRecord(scanResult);
  const files = Array.isArray(scanResult)
    ? scanResult
    : adjutorixTerminalReleasePublicationManifestVerifierArray(record.files || record.entries || record.items || record.paths);

  return files
    .map(adjutorixTerminalReleasePublicationManifestVerifierPath)
    .filter((path) => path.includes(".adjutorix-ai-runway/"))
    .filter((path) => path.includes("terminal-release-publication-manifest"))
    .filter((path) => path.endsWith(".json"))
    .sort();
}

async function adjutorixTerminalReleasePublicationManifestVerifierSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleasePublicationManifestVerifierValidate(
  publicationManifest: Record<string, unknown>,
  actualArchiveBundleVerificationReportSha256: string,
  actualMissionSnapshotSha256: string,
): AdjutorixTerminalReleasePublicationManifestVerifierValidation {
  const failures: string[] = [];
  const archiveBundleVerificationReport = adjutorixTerminalReleasePublicationManifestVerifierRecord(
    publicationManifest.terminal_release_archive_bundle_verification_report,
  );

  if (publicationManifest.schema !== "adjutorix.ai_runway_terminal_release_publication_manifest.v1") failures.push("schema_mismatch");
  if (publicationManifest.source !== "adjutorix-ai-runway-terminal-release-publication-manifest") failures.push("source_mismatch");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(publicationManifest.published_at)) failures.push("published_at_missing");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(publicationManifest.workspace)) failures.push("workspace_missing");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(publicationManifest.terminal_release_archive_bundle_verification_report_sha256)) failures.push("terminal_release_archive_bundle_verification_report_sha256_missing");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(publicationManifest.mission_snapshot_sha256)) failures.push("mission_snapshot_sha256_missing");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(publicationManifest.mission_control_snapshot_text)) failures.push("mission_control_snapshot_text_missing");
  if (publicationManifest.terminal_release_archive_bundle_verification_report_sha256 !== actualArchiveBundleVerificationReportSha256) failures.push("terminal_release_archive_bundle_verification_report_sha256_mismatch");
  if (publicationManifest.mission_snapshot_sha256 !== actualMissionSnapshotSha256) failures.push("mission_snapshot_sha256_mismatch");

  if (archiveBundleVerificationReport.schema !== "adjutorix.ai_runway_terminal_release_archive_bundle_verification_report.v1") failures.push("terminal_release_archive_bundle_verification_report_schema_mismatch");
  if (archiveBundleVerificationReport.source !== "adjutorix-ai-runway-terminal-release-archive-bundle-verifier") failures.push("terminal_release_archive_bundle_verification_report_source_mismatch");
  if (archiveBundleVerificationReport.ok !== true) failures.push("terminal_release_archive_bundle_verification_report_not_ok");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(archiveBundleVerificationReport.workspace)) failures.push("terminal_release_archive_bundle_verification_report_workspace_missing");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(archiveBundleVerificationReport.path)) failures.push("terminal_release_archive_bundle_verification_report_path_missing");
  if (!adjutorixTerminalReleasePublicationManifestVerifierString(archiveBundleVerificationReport.archive_bundle_sha256)) failures.push("terminal_release_archive_bundle_verification_report_archive_bundle_sha256_missing");

  return { ok: failures.length === 0, failures };
}

function installAdjutorixAiRunwayTerminalReleasePublicationManifestVerifier(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-publication-manifest-verifier")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-publication-manifest-verifier";
  panel.className = "adjutorix-ai-runway-terminal-release-publication-manifest-verifier";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release publication manifest verifier");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-publication-manifest-verifier-header";

  const title = document.createElement("strong");
  title.textContent = "Publication Verifier";

  const state = document.createElement("span");
  state.className = "adjutorix-ai-terminal-release-publication-manifest-verifier-state";
  state.textContent = "idle";

  header.appendChild(title);
  header.appendChild(state);

  const select = document.createElement("select");
  select.className = "adjutorix-ai-terminal-release-publication-manifest-verifier-select";

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-publication-manifest-verifier-actions";

  const scanButton = document.createElement("button");
  scanButton.type = "button";
  scanButton.textContent = "Scan Publications";

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.textContent = "Verify Publication";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Report";

  actions.appendChild(scanButton);
  actions.appendChild(verifyButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-publication-manifest-verifier-output";
  output.textContent = "Terminal release publication manifest verifier mounted. Scan for publication manifests.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setState(value: string): void {
    state.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  scanButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleasePublicationManifestVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.scan) {
        setOutput("Workspace OS scan bridge unavailable.");
        return;
      }

      setBusy(scanButton, true);
      setState("scanning");

      try {
        const workspace = await adjutorixTerminalReleasePublicationManifestVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const scanResult = await bridge.scan(workspace);
        const publicationManifests = adjutorixTerminalReleasePublicationManifestVerifierFilesFromScan(scanResult);

        select.replaceChildren();

        for (const publicationPath of publicationManifests) {
          const option = document.createElement("option");
          option.value = publicationPath;
          option.textContent = publicationPath;
          select.appendChild(option);
        }

        setState(publicationManifests.length ? "manifests found" : "no manifests");
        setOutput(JSON.stringify({ ok: true, workspace, publication_manifest_count: publicationManifests.length, publication_manifests: publicationManifests }, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_VERIFIER_SCAN_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-publication-manifest-verifier",
          workspace,
          publication_manifest_count: publicationManifests.length,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE PUBLICATION MANIFEST SCAN FAILED\n${String(error)}`);
      } finally {
        setBusy(scanButton, false);
      }
    })();
  });

  verifyButton.addEventListener("click", () => {
    void (async () => {
      const bridge = adjutorixTerminalReleasePublicationManifestVerifierWindow().adjutorixWorkspaceOS;

      if (!bridge?.readText) {
        setOutput("Workspace OS read bridge unavailable.");
        return;
      }

      if (!select.value) {
        setOutput("No terminal release publication manifest selected.");
        return;
      }

      setBusy(verifyButton, true);
      setState("verifying");

      try {
        const workspace = await adjutorixTerminalReleasePublicationManifestVerifierWorkspace();

        if (!workspace) throw new Error("workspace_not_resolved");

        const readResult = await bridge.readText({ workspace, path: select.value });
        const readRecord = adjutorixTerminalReleasePublicationManifestVerifierRecord(readResult);
        const content = adjutorixTerminalReleasePublicationManifestVerifierString(
          readRecord.content || readRecord.text || readRecord.value || readResult,
        );
        const parsed = adjutorixTerminalReleasePublicationManifestVerifierRecord(JSON.parse(content));
        const publicationManifestSha256 = await adjutorixTerminalReleasePublicationManifestVerifierSha256(content);

        const archiveBundleVerificationReport = adjutorixTerminalReleasePublicationManifestVerifierRecord(
          parsed.terminal_release_archive_bundle_verification_report,
        );
        const canonicalArchiveBundleVerificationReportText = JSON.stringify(archiveBundleVerificationReport, null, 2);
        const actualArchiveBundleVerificationReportSha256 = await adjutorixTerminalReleasePublicationManifestVerifierSha256(
          canonicalArchiveBundleVerificationReportText,
        );

        const missionSnapshotText = adjutorixTerminalReleasePublicationManifestVerifierString(parsed.mission_control_snapshot_text);
        const missionSnapshotSha256 = await adjutorixTerminalReleasePublicationManifestVerifierSha256(missionSnapshotText);

        const validation = adjutorixTerminalReleasePublicationManifestVerifierValidate(
          parsed,
          actualArchiveBundleVerificationReportSha256,
          missionSnapshotSha256,
        );

        const report = {
          schema: "adjutorix.ai_runway_terminal_release_publication_manifest_verification_report.v1",
          source: "adjutorix-ai-runway-terminal-release-publication-manifest-verifier",
          verified_at: new Date().toISOString(),
          workspace,
          path: select.value,
          publication_manifest_sha256: publicationManifestSha256,
          ok: validation.ok,
          validation,
          hashes: {
            terminal_release_archive_bundle_verification_report: {
              ok: parsed.terminal_release_archive_bundle_verification_report_sha256 === actualArchiveBundleVerificationReportSha256,
              expected_sha256: parsed.terminal_release_archive_bundle_verification_report_sha256,
              actual_sha256: actualArchiveBundleVerificationReportSha256,
            },
            mission_snapshot: {
              ok: parsed.mission_snapshot_sha256 === missionSnapshotSha256,
              expected_sha256: parsed.mission_snapshot_sha256,
              actual_sha256: missionSnapshotSha256,
            },
          },
          publication_manifest: parsed,
        };

        setState(validation.ok ? "valid" : "invalid");
        setOutput(JSON.stringify(report, null, 2));

        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_VERIFIED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-publication-manifest-verifier",
          workspace,
          path: select.value,
          publication_manifest_sha256: publicationManifestSha256,
          ok: validation.ok,
          failures: validation.failures,
        }));
      } catch (error) {
        setState("error");
        setOutput(`TERMINAL RELEASE PUBLICATION MANIFEST VERIFY FAILED\n${String(error)}`);
      } finally {
        setBusy(verifyButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(select);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_MANIFEST_VERIFIER_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-publication-manifest-verifier",
    reads: ".adjutorix-ai-runway",
    verifies: "adjutorix.ai_runway_terminal_release_publication_manifest.v1",
    recomputes: "sha256",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleasePublicationManifestVerifier, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleasePublicationManifestVerifier();
}


/**
 * ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_CERTIFICATE_V1
 *
 * Terminal release publication certificate:
 * - consumes terminal-release-publication-manifest verification report output
 * - validates report schema/source/workspace/path/publication manifest hash/ok fields
 * - computes SHA-256 over publication manifest verification report text and mission snapshot text
 * - writes durable terminal release publication certificate JSON into .adjutorix-ai-runway/
 * - requires manual CERTIFY confirmation
 */

interface AdjutorixTerminalReleasePublicationCertificateWorkspaceBridge {
  defaults?: () => Promise<Record<string, unknown>>;
  writeText?: (request: { workspace?: string; path: string; content: string }) => Promise<unknown>;
}

interface AdjutorixTerminalReleasePublicationCertificateRuntimeWindow {
  adjutorixWorkspaceOS?: AdjutorixTerminalReleasePublicationCertificateWorkspaceBridge;
}

function adjutorixTerminalReleasePublicationCertificateWindow(): AdjutorixTerminalReleasePublicationCertificateRuntimeWindow {
  return window as unknown as AdjutorixTerminalReleasePublicationCertificateRuntimeWindow;
}

function adjutorixTerminalReleasePublicationCertificateRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixTerminalReleasePublicationCertificateString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adjutorixTerminalReleasePublicationCertificateText(selector: string): string {
  const element = document.querySelector(selector);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  if (element instanceof HTMLElement) {
    return element.textContent || "";
  }

  return "";
}

function adjutorixTerminalReleasePublicationCertificateTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function adjutorixTerminalReleasePublicationCertificateWorkspace(): Promise<string> {
  const bridge = adjutorixTerminalReleasePublicationCertificateWindow().adjutorixWorkspaceOS;

  if (!bridge?.defaults) {
    return "";
  }

  for (let round = 0; round < 48; round += 1) {
    const defaults = await bridge.defaults();
    const record = adjutorixTerminalReleasePublicationCertificateRecord(defaults);
    const workspace = adjutorixTerminalReleasePublicationCertificateString(
      record.workspace || record.root || record.cwd || record.path || record.workspacePath,
    );

    if (workspace) {
      return workspace;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }

  return "";
}

async function adjutorixTerminalReleasePublicationCertificateSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function adjutorixTerminalReleasePublicationCertificateParseReport(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("terminal_release_publication_manifest_verification_report_empty");
  }

  const parsed = adjutorixTerminalReleasePublicationCertificateRecord(JSON.parse(trimmed));

  if (parsed.schema !== "adjutorix.ai_runway_terminal_release_publication_manifest_verification_report.v1") {
    throw new Error("terminal_release_publication_manifest_verification_report_schema_mismatch");
  }

  if (parsed.source !== "adjutorix-ai-runway-terminal-release-publication-manifest-verifier") {
    throw new Error("terminal_release_publication_manifest_verification_report_source_mismatch");
  }

  if (parsed.ok !== true) {
    throw new Error("terminal_release_publication_manifest_verification_report_not_ok");
  }

  if (!adjutorixTerminalReleasePublicationCertificateString(parsed.workspace)) {
    throw new Error("terminal_release_publication_manifest_verification_report_workspace_missing");
  }

  if (!adjutorixTerminalReleasePublicationCertificateString(parsed.path)) {
    throw new Error("terminal_release_publication_manifest_verification_report_path_missing");
  }

  if (!adjutorixTerminalReleasePublicationCertificateString(parsed.publication_manifest_sha256)) {
    throw new Error("terminal_release_publication_manifest_verification_report_publication_manifest_sha256_missing");
  }

  return parsed;
}

function installAdjutorixAiRunwayTerminalReleasePublicationCertificate(): void {
  if (document.getElementById("adjutorix-ai-runway-terminal-release-publication-certificate")) {
    return;
  }

  const panel = document.createElement("section");
  panel.id = "adjutorix-ai-runway-terminal-release-publication-certificate";
  panel.className = "adjutorix-ai-runway-terminal-release-publication-certificate";
  panel.setAttribute("aria-label", "Adjutorix AI runway terminal release publication certificate");

  const header = document.createElement("div");
  header.className = "adjutorix-ai-terminal-release-publication-certificate-header";

  const title = document.createElement("strong");
  title.textContent = "Publication Certificate";

  const confirm = document.createElement("input");
  confirm.className = "adjutorix-ai-terminal-release-publication-certificate-confirm";
  confirm.placeholder = "Type CERTIFY";
  confirm.spellcheck = false;

  header.appendChild(title);
  header.appendChild(confirm);

  const note = document.createElement("textarea");
  note.className = "adjutorix-ai-terminal-release-publication-certificate-note";
  note.placeholder = "Operator terminal release publication certificate note...";
  note.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "adjutorix-ai-terminal-release-publication-certificate-actions";

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Certificate";

  const writeButton = document.createElement("button");
  writeButton.type = "button";
  writeButton.textContent = "Write Certificate";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Certificate";

  actions.appendChild(previewButton);
  actions.appendChild(writeButton);
  actions.appendChild(copyButton);

  const output = document.createElement("pre");
  output.className = "adjutorix-ai-terminal-release-publication-certificate-output";
  output.textContent = "Terminal release publication certificate mounted. Verify publication manifest first, then type CERTIFY.";

  function setOutput(value: string): void {
    output.textContent = value;
  }

  function setBusy(button: HTMLButtonElement, busy: boolean): void {
    if (busy) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }
  }

  async function buildPublicationCertificate(): Promise<Record<string, unknown>> {
    const workspace = await adjutorixTerminalReleasePublicationCertificateWorkspace();

    if (!workspace) {
      throw new Error("workspace_not_resolved");
    }

    const publicationManifestVerificationText = adjutorixTerminalReleasePublicationCertificateText(
      ".adjutorix-ai-terminal-release-publication-manifest-verifier-output",
    );
    const publicationManifestVerificationReport = adjutorixTerminalReleasePublicationCertificateParseReport(
      publicationManifestVerificationText,
    );
    const publicationManifestVerificationReportSha256 = await adjutorixTerminalReleasePublicationCertificateSha256(
      publicationManifestVerificationText,
    );
    const missionSnapshotText = adjutorixTerminalReleasePublicationCertificateText(".adjutorix-ai-mission-output");
    const missionSnapshotSha256 = await adjutorixTerminalReleasePublicationCertificateSha256(missionSnapshotText);

    return {
      schema: "adjutorix.ai_runway_terminal_release_publication_certificate.v1",
      source: "adjutorix-ai-runway-terminal-release-publication-certificate",
      certified_at: new Date().toISOString(),
      workspace,
      operator_note: note.value,
      terminal_release_publication_manifest_verification_report_sha256: publicationManifestVerificationReportSha256,
      mission_snapshot_sha256: missionSnapshotSha256,
      terminal_release_publication_manifest_verification_report: publicationManifestVerificationReport,
      mission_control_snapshot_text: missionSnapshotText,
    };
  }

  async function writePublicationCertificate(record: Record<string, unknown>): Promise<{ path: string; bytes: number }> {
    const bridge = adjutorixTerminalReleasePublicationCertificateWindow().adjutorixWorkspaceOS;

    if (!bridge?.writeText) {
      throw new Error("workspace_write_bridge_unavailable");
    }

    const workspace = adjutorixTerminalReleasePublicationCertificateString(record.workspace);
    const path = `.adjutorix-ai-runway/${adjutorixTerminalReleasePublicationCertificateTimestamp()}-terminal-release-publication-certificate.json`;
    const content = JSON.stringify(record, null, 2) + "\n";

    await bridge.writeText({ workspace, path, content });

    return { path, bytes: content.length };
  }

  previewButton.addEventListener("click", () => {
    void (async () => {
      setBusy(previewButton, true);
      try {
        const record = await buildPublicationCertificate();
        setOutput(JSON.stringify(record, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_CERTIFICATE_READY", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-publication-certificate",
          workspace: record.workspace,
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE PUBLICATION CERTIFICATE PREVIEW FAILED\n${String(error)}`);
      } finally {
        setBusy(previewButton, false);
      }
    })();
  });

  writeButton.addEventListener("click", () => {
    void (async () => {
      if (confirm.value.trim() !== "CERTIFY") {
        setOutput("Terminal release publication certificate blocked. Type CERTIFY in the confirmation field.");
        return;
      }

      setBusy(writeButton, true);
      try {
        const record = await buildPublicationCertificate();
        const written = await writePublicationCertificate(record);
        confirm.value = "";
        setOutput(JSON.stringify({ ok: true, ...written, publication_certificate: record }, null, 2));
        console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_CERTIFICATE_RECORDED", JSON.stringify({
          source: "adjutorix-ai-runway-terminal-release-publication-certificate",
          workspace: record.workspace,
          path: written.path,
          bytes: written.bytes,
          certifies: "adjutorix.ai_runway_terminal_release_publication_manifest_verification_report.v1",
        }));
      } catch (error) {
        setOutput(`TERMINAL RELEASE PUBLICATION CERTIFICATE FAILED\n${String(error)}`);
      } finally {
        setBusy(writeButton, false);
      }
    })();
  });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard.writeText(output.textContent || "");
  });

  panel.appendChild(header);
  panel.appendChild(note);
  panel.appendChild(actions);
  panel.appendChild(output);

  document.body.appendChild(panel);

  console.log("ADJUTORIX_AI_RUNWAY_TERMINAL_RELEASE_PUBLICATION_CERTIFICATE_MOUNTED", JSON.stringify({
    source: "adjutorix-ai-runway-terminal-release-publication-certificate",
    writes: ".adjutorix-ai-runway",
    requires: "manual-certify-publication-confirmation",
    certifies: "adjutorix.ai_runway_terminal_release_publication_manifest_verification_report.v1",
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installAdjutorixAiRunwayTerminalReleasePublicationCertificate, { once: true });
} else {
  installAdjutorixAiRunwayTerminalReleasePublicationCertificate();
}
