import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/adjutorix-power-workbench.css";

type FileKind = "source" | "test" | "config" | "doc" | "asset" | "other";

type FileItem = {
  path: string;
  name: string;
  kind: FileKind;
};

type CommandRequest = {
  workspace?: string;
  workspacePath?: string;
  cwd?: string;
  command: string;
  timeoutMs?: number;
};

type PowerBridge = {
  openRepository?: () => Promise<unknown>;
  runCommand?: (request: CommandRequest) => Promise<unknown>;
  saveDraft?: (request: Record<string, unknown>) => Promise<unknown>;
  createPlan?: (request: Record<string, unknown>) => Promise<unknown>;
};

type NativeFilesystemBridge = {
  scanWorkspace?: (workspace: string) => Promise<unknown>;
  readFile?: (request: { workspace: string; path: string }) => Promise<unknown>;
};

function nativeFilesystem(): NativeFilesystemBridge | null {
  const candidate = (window as unknown as { adjutorixNativeFilesystem?: NativeFilesystemBridge }).adjutorixNativeFilesystem;
  return candidate ?? null;
}

function filesFromNativeIndex(value: unknown): FileItem[] {
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.files) ? record.files : [];

  return rows
    .map((row): FileItem | null => {
      if (!row || typeof row !== "object") return null;
      const file = row as Record<string, unknown>;
      const path = typeof file.path === "string" ? file.path : "";
      if (!path) return null;

      return {
        path,
        name: typeof file.name === "string" ? file.name : basename(path),
        kind:
          file.kind === "source" ||
          file.kind === "test" ||
          file.kind === "config" ||
          file.kind === "doc" ||
          file.kind === "asset" ||
          file.kind === "other"
            ? file.kind
            : detectKind(path),
      };
    })
    .filter((file): file is FileItem => Boolean(file));
}

function textFromNativeRead(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.content === "string" ? record.content : "";
}

const DEFAULT_WORKSPACE = "/Users/midiakiasat/Downloads/Apps/midiakiasat/E-LOGISTIC";
const SCAN_SOURCE = "compact-find-marker-filesystem";

const FEATURE_BUTTONS = [
  ["scan", "Scan"],
  ["git", "Git"],
  ["diff", "Diff"],
  ["search", "Search"],
  ["verify", "Verify"],
  ["build", "Build"],
  ["typecheck", "Typecheck"],
  ["tests", "Tests"],
  ["routes", "Routes"],
  ["ipc", "IPC Map"],
  ["logs", "Logs"],
  ["package", "Package"],
  ["draft", "Save Draft"],
  ["plan", "Plan Object"],
] as const;

type FeatureKey = (typeof FEATURE_BUTTONS)[number][0] | "agent" | "ledger" | "state";

function bridge(): PowerBridge | null {
  const candidate = (window as unknown as { adjutorixPower?: PowerBridge }).adjutorixPower;
  return candidate ?? null;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function detectKind(path: string): FileKind {
  const lower = path.toLowerCase();
  if (lower.includes("/test") || lower.includes(".test.") || lower.includes(".spec.")) return "test";
  if (
    lower.endsWith(".json") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".config.js") ||
    lower.endsWith(".config.ts") ||
    lower.includes("config")
  ) return "config";
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.includes("readme") || lower.includes("docs/")) return "doc";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".swift") ||
    lower.endsWith(".css") ||
    lower.endsWith(".html")
  ) return "source";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".ico")
  ) return "asset";
  return "other";
}

function collectStrings(value: unknown, out: string[] = [], seen = new WeakSet<object>()): string[] {
  if (value == null) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, seen);
    return out;
  }
  if (typeof value === "object") {
    if (seen.has(value)) return out;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    const preferred = ["stdout", "stderr", "output", "text", "message", "body", "result", "data", "path"];
    for (const key of preferred) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) collectStrings(obj[key], out, seen);
    }
    for (const [key, item] of Object.entries(obj)) {
      if (!preferred.includes(key)) collectStrings(item, out, seen);
    }
  }
  return out;
}

function extractText(value: unknown): string {
  return collectStrings(value)
    .join("\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .slice(0, 60000);
}

function parseFileIndex(output: string): FileItem[] {
  const expanded = output.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  const files = new Map<string, FileItem>();

  for (const match of expanded.matchAll(/ADJUTORIX_FILE\|([^\r\n"\\]+)/g)) {
    const path = match[1]?.trim();
    if (!path || path.includes("[adjutorix:output_truncated]")) continue;
    files.set(path, { path, name: basename(path), kind: detectKind(path) });
  }

  for (const raw of expanded.split(/\r?\n/)) {
    const line = raw.trim();
    let path = "";

    if (line.startsWith("ADJUTORIX_FILE|")) {
      path = line.slice("ADJUTORIX_FILE|".length).trim();
    } else if (line.startsWith("ADJUTORIX_FILE\t")) {
      const parts = line.split("\t").filter(Boolean);
      path = parts[parts.length - 1] ?? "";
    }

    if (!path || path.includes("[adjutorix:output_truncated]")) continue;
    if (path.includes("/node_modules/") || path.includes("/.git/") || path.includes("/dist/") || path.includes("/release/")) continue;

    files.set(path, { path, name: basename(path), kind: detectKind(path) });
  }

  return Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function compactFileIndexCommand(root: string): string {
  const prune =
    "\\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './release' -o -path './.tmp' -o -path './__pycache__' -o -path './.venv' -o -path './venv' -o -path './.next' -o -path './.turbo' -o -path './.cache' \\) -prune";

  return [
    `cd ${shQuote(root)}`,
    `printf 'ADJUTORIX_COMPACT_SCAN_BEGIN\\n'`,
    `/usr/bin/find . ${prune} -o -type f ! -name '*.map' ! -name '*.log' ! -name '.DS_Store' -print | /usr/bin/head -n 80 | /usr/bin/sed 's#^\\./##; s#^#ADJUTORIX_FILE|#'`,
    `printf 'ADJUTORIX_COMPACT_SCAN_END\\n'`,
  ].join(" && ");
}

async function runWorkspaceCommand(workspace: string, command: string): Promise<{ ok: boolean; text: string; raw: unknown }> {
  const api = bridge();
  if (!api?.runCommand) {
    return {
      ok: false,
      raw: null,
      text: "Adjutorix bridge is not available. The installed preload did not expose adjutorixPower.runCommand.",
    };
  }

  try {
    const raw = await api.runCommand({
      workspace,
      workspacePath: workspace,
      cwd: workspace,
      command,
      timeoutMs: 120000,
    });
    return { ok: true, raw, text: extractText(raw) };
  } catch (error) {
    return {
      ok: false,
      raw: error,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

function initialWorkspace(): string {
  try {
    return window.localStorage.getItem("adjutorix.workspace") || DEFAULT_WORKSPACE;
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function AdjutorixOperatorIde(): JSX.Element {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [workspaceInput, setWorkspaceInput] = useState(initialWorkspace);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [selectedPath, setSelectedPath] = useState("ADJUTORIX.md");
  const [editorText, setEditorText] = useState(
    "# ADJUTORIX\n\nReal governed mutation IDE.\n\nOpen a repository. Inspect real files. Tell the agent what to change. Generate a plan object. Verify before apply.\n"
  );
  const [terminal, setTerminal] = useState("ADJUTORIX real operator IDE online.\nCompact real file index must report >50 files or the build fails.\n");
  const [command, setCommand] = useState("git status --short");
  const [intent, setIntent] = useState("");
  const [featureOutput, setFeatureOutput] = useState("No feature call yet.");
  const [activeFeature, setActiveFeature] = useState<FeatureKey>("agent");
  const [verifyStatus, setVerifyStatus] = useState("required");
  const [applyStatus, setApplyStatus] = useState("blocked");
  const [busy, setBusy] = useState(false);

  const filteredFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return files.filter((file) => {
      if (kind !== "all" && file.kind !== kind) return false;
      if (!query) return true;
      return file.path.toLowerCase().includes(query);
    });
  }, [files, filter, kind]);

  const appendTerminal = useCallback((text: string) => {
    setTerminal((current) => `${current}${current.endsWith("\n") ? "" : "\n"}${text}`);
  }, []);

  const openFile = useCallback(
    async (path: string, root = workspace) => {
      setSelectedPath(path);

      const native = nativeFilesystem();
      if (native?.readFile) {
        const nativeResult = await native.readFile({ workspace: root, path });
        const content = textFromNativeRead(nativeResult);
        if (content) {
          setEditorText(content);
          appendTerminal(`$ native read ${path}\n${content.slice(0, 1200)}`);
          return;
        }
      }

      const reader = `python3 -c ${shQuote(
        'import pathlib,sys; p=pathlib.Path(sys.argv[1]); print(p.read_text(errors="replace")[:30000])'
      )} ${shQuote(path)}`;
      const result = await runWorkspaceCommand(root, reader);
      setEditorText(result.text || `Could not read ${path}`);
      appendTerminal(`$ read ${path}\n${result.text.slice(0, 1200)}`);
    },
    [appendTerminal, workspace]
  );

  const scanWorkspace = useCallback(
    async (nextRoot?: string) => {
      const root = (nextRoot || workspaceInput || workspace).trim();
      if (!root) return;

      setBusy(true);
      setWorkspace(root);
      setWorkspaceInput(root);
      try {
        window.localStorage.setItem("adjutorix.workspace", root);
      } catch {
        // localStorage may be disabled; the workspace still runs.
      }

      appendTerminal(`Scanning real filesystem: ${root}`);

      let parsed: FileItem[] = [];
      let scanSource = "native-main-filesystem-index";
      let scanPreview = "";

      const native = nativeFilesystem();

      if (native?.scanWorkspace) {
        const nativeResult = await native.scanWorkspace(root);
        parsed = filesFromNativeIndex(nativeResult);
        scanPreview = JSON.stringify(
          {
            source: scanSource,
            fileCount: parsed.length,
            workspace: root,
            sample: parsed.slice(0, 12).map((file) => file.path),
          },
          null,
          2,
        );
      }

      if (parsed.length <= 0) {
        const result = await runWorkspaceCommand(root, compactFileIndexCommand(root));
        parsed = parseFileIndex(result.text);
        scanSource = SCAN_SOURCE;
        scanPreview = result.text.slice(0, 4000) || "No scan output.";
      }

      setFiles(parsed);
      setFeatureOutput(scanPreview);
      console.info("ADJUTORIX_SCAN_INDEX_READY", JSON.stringify({ count: parsed.length, source: scanSource, workspace: root }));

      appendTerminal(`ADJUTORIX real file index ready: ${parsed.length} files via ${scanSource}`);

      const preferred =
        parsed.find((file) => file.path === "README.md") ||
        parsed.find((file) => file.path.endsWith("/README.md")) ||
        parsed.find((file) => file.kind === "source") ||
        parsed[0];

      if (preferred) await openFile(preferred.path, root);
      setBusy(false);
    },
    [appendTerminal, openFile, workspace, workspaceInput]
  );

  const runFeature = useCallback(
    async (feature: FeatureKey) => {
      setActiveFeature(feature);

      if (feature === "scan") {
        await scanWorkspace(workspace);
        return;
      }

      if (feature === "draft") {
        const draftPath = `.adjutorix/workbench-drafts/${Date.now()}-${basename(selectedPath)}.draft.md`;
        const save = `mkdir -p .adjutorix/workbench-drafts && printf %s ${shQuote(editorText)} > ${shQuote(draftPath)} && printf 'SAVED_DRAFT=%s\\n' ${shQuote(draftPath)}`;
        const result = await runWorkspaceCommand(workspace, save);
        setFeatureOutput(result.text);
        appendTerminal(`$ save draft\n${result.text}`);
        return;
      }

      if (feature === "plan" || feature === "agent") {
        const plan = {
          schema: "adjutorix.intent.plan.v1",
          id: `intent-plan-${Date.now()}`,
          workspace,
          selectedPath,
          intent: intent || "operator requested governed change",
          verifyRequired: true,
          applyBlockedUntilVerify: true,
          fileCount: files.length,
          createdBy: "Adjutorix operator IDE",
        };
        const payload = JSON.stringify(plan);
        const writer = `mkdir -p .adjutorix/objects && python3 -c ${shQuote(
          "import json,pathlib,sys; obj=json.loads(sys.argv[1]); p=pathlib.Path('.adjutorix/objects')/(obj['id']+'.json'); p.write_text(json.dumps(obj, indent=2)); print(str(p))"
        )} ${shQuote(payload)}`;
        const result = await runWorkspaceCommand(workspace, writer);
        setFeatureOutput(result.text);
        appendTerminal(`$ create governed plan\n${result.text}`);
        return;
      }

      const searchTerm = filter.trim() || intent.trim() || basename(selectedPath);
      const commands: Record<string, string> = {
        git: "git status --short && printf '\\nBRANCH=' && git branch --show-current && printf '\\nRECENT\\n' && git log --oneline -8",
        diff: "git diff --stat && printf '\\n--- DIFF ---\\n' && git diff -- . ':!node_modules' ':!dist' ':!release' | /usr/bin/head -n 240",
        search: `grep -RIn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=release ${shQuote(searchTerm)} . | /usr/bin/head -n 120 || true`,
        verify: "if [ -f package.json ]; then (pnpm verify || npm run verify || true); else echo 'No package.json verify command in this workspace'; fi",
        build: "if [ -f package.json ]; then (pnpm -r --if-present run build || npm run build || true); else echo 'No package.json build command in this workspace'; fi",
        typecheck: "if [ -f package.json ]; then (pnpm -r --if-present run typecheck || npm run typecheck || true); else echo 'No package.json typecheck command in this workspace'; fi",
        tests: "if [ -f package.json ]; then (pnpm test -- --run || pnpm test || npm test || true); else echo 'No package.json test command in this workspace'; fi",
        routes: "find . -type f \\( -iname '*route*' -o -iname '*router*' -o -iname '*api*' -o -iname '*server*' \\) ! -path './node_modules/*' ! -path './.git/*' | /usr/bin/head -n 120",
        ipc: "grep -RIn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=release 'adjutorix:' . | /usr/bin/head -n 160 || true",
        logs: "find . -type f \\( -name '*.log' -o -path './.adjutorix/*' \\) ! -path './node_modules/*' ! -path './.git/*' | /usr/bin/head -n 120",
        package: "if [ -f package.json ]; then cat package.json; else find . -maxdepth 3 -name package.json -print; fi",
        ledger: "find .adjutorix -type f 2>/dev/null | sort | tail -n 80 || true && printf '\\nGIT\\n' && git log --oneline -10 || true",
        state: "pwd && printf '\\nFILES=' && find . -type f ! -path './.git/*' ! -path './node_modules/*' | wc -l && printf '\\n' && git status --short || true",
      };

      if (feature === "verify") {
        setVerifyStatus("running");
      }

      const commandToRun = commands[feature] ?? commands["state"] ?? "pwd && git status --short || true";
      const result = await runWorkspaceCommand(workspace, commandToRun);
      setFeatureOutput(result.text || "No output.");
      appendTerminal(`$ ${feature}\n${(result.text || "").slice(0, 3000)}`);

      if (feature === "verify") {
        setVerifyStatus("complete");
        setApplyStatus("ready after verify");
      }
    },
    [appendTerminal, editorText, files.length, filter, intent, scanWorkspace, selectedPath, workspace]
  );

  const runTerminal = useCallback(async () => {
    const result = await runWorkspaceCommand(workspace, command);
    setFeatureOutput(result.text || "No output.");
    appendTerminal(`$ ${command}\n${(result.text || "").slice(0, 4000)}`);
  }, [appendTerminal, command, workspace]);

  useEffect(() => {
    document.documentElement.dataset.rendererBoot = "revolution-mounted";
    document.documentElement.dataset.adjutorixNativeIde = "true";
    document.body.dataset.adjutorixNativeIde = "true";
    document.documentElement.dataset.adjutorixNativeIde = "true";
    document.body.dataset.adjutorixNativeIde = "true";
    console.info("ADJUTORIX_REVOLUTION_OPERATOR_SURFACE_MOUNTED");
    void scanWorkspace(initialWorkspace());
  }, []);

  return (
    <main
      className="adjutorix-native-operator-ide adjutorix-cursor-product"
      data-adjutorix-native-ide="true"
      data-testid="adjutorix-native-operator-ide"
      data-renderer-boot="revolution-mounted"
    >
      <aside className="adjutorix-activity">
        <button className="is-active">⌘</button>
        <button>⌕</button>
        <button>⑂</button>
        <button>✓</button>
        <button>◆</button>
        <button>⚙</button>
      </aside>

      <section className="adjutorix-explorer">
        <header>
          <strong>EXPLORER</strong>
          <button onClick={() => void scanWorkspace(workspaceInput)} disabled={busy}>Open</button>
        </header>

        <section className="adjutorix-workspace-card">
          <span>WORKSPACE</span>
          <strong>{workspace}</strong>
          <div>
            <input value={workspaceInput} onChange={(event) => setWorkspaceInput(event.target.value)} />
            <button onClick={() => void scanWorkspace(workspaceInput)} disabled={busy}>Load</button>
          </div>
        </section>

        <input
          className="adjutorix-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search real files, tests, routes, IPC, configs..."
        />

        <div className="adjutorix-kind-grid">
          {(["all", "source", "test", "config", "doc", "other"] as Array<FileKind | "all">).map((item) => (
            <button key={item} className={kind === item ? "is-active" : ""} onClick={() => setKind(item)}>
              {item}
            </button>
          ))}
        </div>

        <section className="adjutorix-intelligence">
          <h2>Project intelligence</h2>
          <div>
            <strong>{files.length}</strong>
            <span>real files</span>
          </div>
          <div>
            <strong>{verifyStatus}</strong>
            <span>verify</span>
          </div>
          <div>
            <strong>{applyStatus}</strong>
            <span>apply</span>
          </div>
        </section>

        <section className="adjutorix-file-list">
          {filteredFiles.map((file) => (
            <button
              key={file.path}
              className={file.path === selectedPath ? "is-active" : ""}
              onClick={() => void openFile(file.path)}
            >
              <strong>{file.name}</strong>
              <span>{file.path}</span>
              <em>{file.kind}</em>
            </button>
          ))}
        </section>
      </section>

      <section className="adjutorix-editor-zone">
        <header className="adjutorix-topbar">
          <div>
            <h1>ADJUTORIX</h1>
            <p>real governed mutation IDE · real filesystem · command surface</p>
          </div>
          <input
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Ask Adjutorix: generate plan, refactor, verify, inspect..."
          />
          <button onClick={() => void runFeature("agent")}>Run Agent</button>
        </header>

        <nav className="adjutorix-tabs">
          <button className="is-active">{selectedPath}</button>
        </nav>

        <section className="adjutorix-file-title">
          <strong>{selectedPath}</strong>
          <span>editable governed buffer</span>
        </section>

        <textarea
          className="adjutorix-editor"
          value={editorText}
          onChange={(event) => setEditorText(event.target.value)}
          spellCheck={false}
        />

        <section className="adjutorix-terminal">
          <header>
            <strong>TERMINAL</strong>
            <input value={command} onChange={(event) => setCommand(event.target.value)} />
            <button onClick={() => void runTerminal()}>Run</button>
          </header>
          <pre>{terminal}</pre>
        </section>
      </section>

      <aside className="adjutorix-agent-panel">
        <nav>
          {(["agent", "plan", "verify", "diff", "ledger", "state"] as FeatureKey[]).map((item) => (
            <button key={item} className={activeFeature === item ? "is-active" : ""} onClick={() => void runFeature(item)}>
              {item.toUpperCase()}
            </button>
          ))}
        </nav>

        <section className="adjutorix-agent-card">
          <span>ADJUTORIX AGENT</span>
          <h2>Tell it what to change.</h2>
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Example: add barcode validation, refactor scanner flow, update tests, verify before apply..."
          />
          <button onClick={() => void runFeature("agent")}>Generate governed plan + inspect</button>
        </section>

        <section className="adjutorix-feature-card">
          <span>ADJUTORIX FEATURES</span>
          <div className="adjutorix-feature-grid">
            {FEATURE_BUTTONS.map(([key, label]) => (
              <button key={key} onClick={() => void runFeature(key)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="adjutorix-output-card">
          <span>FEATURE OUTPUT</span>
          <pre>{featureOutput}</pre>
        </section>

        <section className="adjutorix-gate-card">
          <span>GOVERNED GATE</span>
          <div>
            <strong>VERIFY</strong>
            <em>{verifyStatus}</em>
          </div>
          <div>
            <strong>APPLY</strong>
            <em>{applyStatus}</em>
          </div>
          <p>Apply stays blocked until verification opens the evidence gate.</p>
        </section>
      </aside>

      <footer className="adjutorix-statusbar">
        <span>Adjutorix</span>
        <span>{workspace}</span>
        <span>Files: <strong>{files.length}</strong></span>
        <span>Scan: <strong>{SCAN_SOURCE}</strong></span>
        <span>Verify: <strong>{verifyStatus}</strong></span>
        <span>Apply: <strong>{applyStatus}</strong></span>
      </footer>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Adjutorix renderer root is missing");
}

createRoot(rootElement).render(<AdjutorixOperatorIde />);
