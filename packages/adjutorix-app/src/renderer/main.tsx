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
