import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type BridgeApi = {
  openRepository?: () => Promise<unknown>;
  runCommand?: (input: unknown) => Promise<unknown>;
};

type FileEntry = {
  path: string;
  name: string;
};

type Tab = {
  path: string;
  content: string;
  dirty: boolean;
};

type ChatRole = "operator" | "adjutorix" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  body: string;
};

type FeatureKey =
  | "agent"
  | "plan"
  | "code"
  | "diff"
  | "verify"
  | "patch"
  | "ledger"
  | "diagnostics"
  | "kernel"
  | "package"
  | "ipc";

type BridgeFunction = (...args: unknown[]) => Promise<unknown> | unknown;

function browserBridgeValue(key: string): unknown {
  return (window as unknown as Record<string, unknown>)[key];
}

function powerBridge(): BridgeApi | undefined {
  return browserBridgeValue("adjutorixPower") as BridgeApi | undefined;
}

function adjutorixBridge(): unknown {
  return browserBridgeValue("adjutorix");
}

function adjutorixOperatorKernelBridge(): unknown {
  return browserBridgeValue("adjutorixOperatorKernel");
}

const HOME_DOC = `# ADJUTORIX

This is the working operator surface.

Ask Adjutorix what to change.
It scans real files, opens real buffers, writes plan objects, runs commands, shows output, checks diff, verifies before apply, and keeps the apply gate blocked until verification is explicit.
`;

const COMMANDS: Record<
  FeatureKey,
  Array<{ label: string; command: string }>
> = {
  agent: [
    {
      label: "Workspace map",
      command: "find . -maxdepth 3 -type f | sed 's#^./##' | head -160",
    },
    { label: "Repo status", command: "git status --short" },
    { label: "Recent commits", command: "git log --oneline -12" },
  ],
  plan: [
    {
      label: "Create plan",
      command: "find .adjutorix/objects -type f 2>/dev/null | sort | tail -40",
    },
    {
      label: "Plan objects",
      command: "find .adjutorix/objects -type f 2>/dev/null | sort | tail -120",
    },
    {
      label: "Latest plan",
      command:
        'latest=$(find .adjutorix/objects -type f 2>/dev/null | sort | tail -1); test -n "$latest" && cat "$latest" || true',
    },
  ],
  code: [
    {
      label: "Search TODO",
      command:
        'grep -RIn "TODO\\|FIXME\\|throw new Error\\|console.error" app packages src scripts 2>/dev/null | head -120',
    },
    {
      label: "Large files",
      command:
        "find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './dist/*' -size +100k | head -80",
    },
    {
      label: "Routes",
      command:
        "find . -type f \\( -name '*.js' -o -name '*.ts' -o -name '*.tsx' \\) -not -path './node_modules/*' -print | xargs grep -n \"route\\|router\\|endpoint\\|api\" 2>/dev/null | head -140",
    },
  ],
  diff: [
    { label: "Diff stat", command: "git diff --stat" },
    { label: "Diff body", command: "git diff | head -260" },
    {
      label: "Staged diff",
      command: "git diff --cached --stat && git diff --cached | head -220",
    },
  ],
  verify: [
    {
      label: "Typecheck",
      command: "pnpm --filter @adjutorix/app run build:ts",
    },
    {
      label: "Target tests",
      command:
        "pnpm --filter @adjutorix/app exec vitest run tests/renderer/operator_kernel_live_surface_contract.test.ts tests/renderer/operator_surface_spine_contract.test.ts tests/renderer/operator_unified_control_spine_contract.test.ts",
    },
    { label: "Full verify", command: "pnpm run verify" },
  ],
  patch: [
    {
      label: "Patch preview",
      command: "git diff --stat && git diff | head -260",
    },
    { label: "Changed files", command: "git status --short" },
    {
      label: "Patch custody",
      command:
        "find .adjutorix reports/current -type f 2>/dev/null | sort | tail -120",
    },
  ],
  ledger: [
    {
      label: "Ledger files",
      command:
        "find .adjutorix reports/current -type f 2>/dev/null | sort | tail -180",
    },
    {
      label: "Report heads",
      command:
        "find reports/current -maxdepth 1 -type f 2>/dev/null | sort | tail -80",
    },
    {
      label: "Receipt hashes",
      command:
        "find .adjutorix reports/current -type f 2>/dev/null | xargs shasum 2>/dev/null | tail -80",
    },
  ],
  diagnostics: [
    {
      label: "Runtime logs",
      command:
        "find . -name '*.log' -type f -not -path './node_modules/*' 2>/dev/null | head -80",
    },
    {
      label: "Electron app files",
      command:
        "find /Applications/Adjutorix.app/Contents/Resources -maxdepth 6 -type f 2>/dev/null | head -160",
    },
    {
      label: "Package config",
      command: "cat packages/adjutorix-app/package.json | head -220",
    },
  ],
  kernel: [
    {
      label: "Kernel bridge",
      command:
        'grep -RIn "operatorKernel\\|operatorKernelReceiptId\\|operatorKernelHash\\|previousKernelHash" packages/adjutorix-app/src configs tests | head -180',
    },
    {
      label: "IPC kernel",
      command:
        'grep -RIn "adjutorix:operatorKernel\\|createReceipt\\|lastHash" packages/adjutorix-app/src | head -120',
    },
    {
      label: "Kernel policy",
      command:
        "cat configs/runtime/operator_kernel_live_surface_policy.json 2>/dev/null || true",
    },
  ],
  package: [
    { label: "Build all", command: "pnpm -r --if-present run build" },
    {
      label: "Install app",
      command:
        "ADJUTORIX_NO_OPEN=1 bash scripts/app/install-one-adjutorix-app.sh",
    },
    {
      label: "Installed app",
      command:
        "find /Applications/Adjutorix.app/Contents -maxdepth 4 -type f | head -160",
    },
  ],
  ipc: [
    {
      label: "IPC handlers",
      command:
        'grep -RIn "ipcMain.handle\\|safeHandle\\|exposeInMainWorld" packages/adjutorix-app/src | head -220',
    },
    {
      label: "Preload bridge",
      command:
        'grep -RIn "exposeInMainWorld\\|adjutorixPower\\|adjutorixOperatorKernel" packages/adjutorix-app/src/preload packages/adjutorix-app/src/renderer | head -180',
    },
    {
      label: "IPC registry",
      command:
        "node scripts/ci/guard-ipc-channel-registry.mjs 2>/dev/null || true",
    },
  ],
};

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function id(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function b64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function asJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findStringByKey(
  value: unknown,
  keys: string[],
  seen = new Set<unknown>(),
): string {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findStringByKey(item, keys, seen);
      if (hit) return hit;
    }
    return "";
  }

  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string") return direct;
  }

  for (const nestedKey of [
    "result",
    "payload",
    "data",
    "value",
    "body",
    "response",
  ]) {
    const hit = findStringByKey(record[nestedKey], keys, seen);
    if (hit) return hit;
  }

  for (const item of Object.values(record)) {
    const hit = findStringByKey(item, keys, seen);
    if (hit) return hit;
  }

  return "";
}

function stdout(value: unknown): string {
  if (typeof value === "string") return value;
  return findStringByKey(value, ["stdout", "output", "content", "text"]);
}

function stderr(value: unknown): string {
  return findStringByKey(value, ["stderr", "error"]);
}

function display(value: unknown): string {
  const out = stdout(value).trimEnd();
  const err = stderr(value).trimEnd();

  if (out && err) return `${out}\n${err}`;
  if (out) return out;
  if (err) return err;

  return asJson(value);
}

function between(value: string, start: string, end: string): string {
  const a = value.indexOf(start);
  const b = value.indexOf(end);
  if (a >= 0 && b > a)
    return value
      .slice(a + start.length, b)
      .replace(/^\s*\n/, "")
      .replace(/\n\s*$/, "");
  return value;
}

function cleanFileLine(raw: string): string {
  return raw.replace(/^\.\//, "").trim();
}

function isFileLine(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return false;
  if (path.startsWith("$")) return false;
  if (
    path.includes('"path"') ||
    path.includes('"files"') ||
    path.includes('":"')
  )
    return false;
  if (path.length > 220) return false;
  return (
    path.includes("/") || path.includes(".") || /^[A-Z0-9_.-]{3,}$/i.test(path)
  );
}

function filesFromOutput(raw: string): FileEntry[] {
  const seen = new Set<string>();
  const files: FileEntry[] = [];

  for (const line of raw.split(/\r?\n/g)) {
    const path = cleanFileLine(line);
    if (!isFileLine(path) || seen.has(path)) continue;
    seen.add(path);
    files.push({ path, name: basename(path) });
    if (files.length >= 4000) break;
  }

  return files;
}

function findBridgeFunction(
  root: unknown,
  path: string,
): BridgeFunction | null {
  let node: unknown = root;

  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[part];
  }

  return typeof node === "function" ? (node as BridgeFunction) : null;
}

function selectedPathFromDialog(value: unknown): string {
  const found = findStringByKey(value, [
    "workspace",
    "workspacePath",
    "root",
    "rootPath",
    "path",
    "filePath",
    "selectedPath",
  ]);
  return found.startsWith("/") ? found : "";
}

function intentKeywords(intent: string): string[] {
  return Array.from(
    new Set(
      intent
        .toLowerCase()
        .replace(/[^a-z0-9_./-]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .filter(
          (word) =>
            ![
              "the",
              "and",
              "for",
              "with",
              "what",
              "are",
              "you",
              "this",
              "that",
              "change",
              "make",
              "add",
              "fix",
            ].includes(word),
        ),
    ),
  ).slice(0, 8);
}

export function AdjutorixPowerWorkbench(): JSX.Element {
  const api = powerBridge();

  const [workspace, setWorkspace] = useState(
    () => localStorage.getItem("adjutorix.lastWorkspace") ?? "",
  );
  const [pathInput, setPathInput] = useState(
    () => localStorage.getItem("adjutorix.lastWorkspace") ?? "",
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([
    { path: "ADJUTORIX.md", content: HOME_DOC, dirty: false },
  ]);
  const [activePath, setActivePath] = useState("ADJUTORIX.md");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("git status --short");
  const [terminal, setTerminal] = useState<string[]>([
    "ADJUTORIX LIVE. Open a folder, ask, inspect, verify, patch.",
  ]);
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      id: id(),
      role: "adjutorix",
      body: "Alive. Open a workspace or ask me what to change. I will create a governed plan and show the real command/output boundary.",
    },
  ]);
  const [feature, setFeature] = useState<FeatureKey>("agent");
  const [featureOutput, setFeatureOutput] = useState("No command has run yet.");
  const [verifyReady, setVerifyReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const didAutoScan = useRef(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? tabs[0],
    [activePath, tabs],
  );

  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? files.filter((file) => file.path.toLowerCase().includes(needle))
      : files;
    return list.slice(0, 1600);
  }, [files, query]);

  const addChat = useCallback((role: ChatRole, body: string) => {
    setChat((current) => [...current.slice(-60), { id: id(), role, body }]);
  }, []);

  const log = useCallback((line: string) => {
    setTerminal((current) => [...current.slice(-300), line]);
  }, []);

  const invokeCommand = useCallback(
    async (
      nextCommand: string,
      cwd = workspace,
      show = true,
    ): Promise<unknown> => {
      if (!api?.runCommand) {
        const msg = "ERROR: governed command bridge is missing.";
        log(msg);
        return msg;
      }

      const trimmed = nextCommand.trim();
      if (!trimmed) return "";

      setBusy(true);
      log(`$ ${trimmed}`);

      try {
        const result = await api.runCommand({
          command: trimmed,
          cwd: cwd || undefined,
          workspace: cwd || undefined,
        });
        const rendered = display(result);
        if (show && rendered.trim()) log(rendered);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`ERROR: ${message}`);
        return message;
      } finally {
        setBusy(false);
      }
    },
    [api, log, workspace],
  );

  const runFeatureCommand = useCallback(
    async (label: string, nextCommand: string) => {
      setFeatureOutput(`Running ${label}...`);
      const result = await invokeCommand(nextCommand, workspace, false);
      const rendered = display(result);
      setFeatureOutput(rendered || "(no output)");
      addChat("system", `${label} completed.`);
      if (
        label.toLowerCase().includes("verify") ||
        nextCommand.includes("verify")
      ) {
        setVerifyReady(!/fail|error|ELIFECYCLE|ERR_/i.test(rendered));
      }
    },
    [addChat, invokeCommand, workspace],
  );

  const runBridgeFeature = useCallback(
    async (label: string, bridgePath: string, fallbackCommand: string) => {
      const fn = findBridgeFunction(adjutorixBridge(), bridgePath);

      if (!fn) {
        await runFeatureCommand(label, fallbackCommand);
        return;
      }

      setFeatureOutput(`Running ${label} through ${bridgePath}...`);

      try {
        const result = await fn();
        const rendered = asJson(result);
        setFeatureOutput(rendered);
        addChat("system", `${label} bridge completed.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeatureOutput(message);
        addChat("system", `${label} bridge failed; use fallback command.`);
      }
    },
    [addChat, runFeatureCommand],
  );

  const scanWorkspace = useCallback(
    async (root: string) => {
      const cwd = root.trim();
      if (!cwd) {
        addChat("system", "Workspace path is empty.");
        return;
      }

      setWorkspace(cwd);
      setPathInput(cwd);
      localStorage.setItem("adjutorix.lastWorkspace", cwd);

      const cmd =
        "printf '__ADJUTORIX_SCAN_BEGIN__\\n'; find . -maxdepth 8 \\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './release' -o -path './.tmp' -o -path './__pycache__' \\) -prune -o -type f -print | sed 's#^./##' | head -4000; printf '\\n__ADJUTORIX_SCAN_END__\\n'";
      const result = await invokeCommand(cmd, cwd, false);
      const raw = between(
        stdout(result),
        "__ADJUTORIX_SCAN_BEGIN__",
        "__ADJUTORIX_SCAN_END__",
      );
      const indexed = filesFromOutput(raw || stdout(result));

      setFiles(indexed);
      log(`REAL INDEX: ${indexed.length} files`);
      addChat(
        "adjutorix",
        `Workspace loaded. I indexed ${indexed.length} real files. Ask for a change or run Verify/Diff/Ledger.`,
      );
    },
    [addChat, invokeCommand, log],
  );

  const readFile = useCallback(
    async (file: FileEntry, cwd = workspace) => {
      if (!cwd) return;

      const cmd = `printf '__ADJUTORIX_FILE_BEGIN__\\n'; python3 - ${shellQuote(file.path)} <<'PY'
import pathlib, sys
root=pathlib.Path.cwd().resolve()
target=(root / sys.argv[1]).resolve()
if root not in target.parents and target != root:
    raise SystemExit("outside workspace")
print(target.read_text(encoding="utf-8", errors="replace"))
PY
printf '\\n__ADJUTORIX_FILE_END__\\n'`;

      const result = await invokeCommand(cmd, cwd, false);
      const content = between(
        stdout(result),
        "__ADJUTORIX_FILE_BEGIN__",
        "__ADJUTORIX_FILE_END__",
      );

      setTabs((current) => {
        const exists = current.some((tab) => tab.path === file.path);
        if (exists)
          return current.map((tab) =>
            tab.path === file.path ? { ...tab, content, dirty: false } : tab,
          );
        return [...current, { path: file.path, content, dirty: false }];
      });

      setActivePath(file.path);
      log(`OPENED ${file.path}`);
    },
    [invokeCommand, log, workspace],
  );

  useEffect(() => {
    if (workspace && !didAutoScan.current) {
      didAutoScan.current = true;
      void scanWorkspace(workspace);
    }
  }, [scanWorkspace, workspace]);

  const openRepository = useCallback(async () => {
    if (!api?.openRepository) {
      addChat("system", "Open dialog is missing. Paste path and press Load.");
      return;
    }

    setBusy(true);

    try {
      const result = await api.openRepository();
      const selected = selectedPathFromDialog(result);
      if (selected) await scanWorkspace(selected);
    } finally {
      setBusy(false);
    }
  }, [addChat, api, scanWorkspace]);

  const createPlan = useCallback(async () => {
    const intent = prompt.trim();

    if (!intent) {
      addChat(
        "adjutorix",
        "Alive. Give me a concrete target: file, behavior, bug, or feature.",
      );
      return;
    }

    addChat("operator", intent);

    if (/alive|there|working|online/i.test(intent)) {
      addChat(
        "adjutorix",
        `Yes. I am live. Workspace: ${workspace || "not loaded"}. Files indexed: ${files.length}. Apply is ${verifyReady ? "available after review" : "blocked until verification"}.`,
      );
      return;
    }

    if (!workspace) {
      addChat(
        "adjutorix",
        "Open a workspace first. Then I can inspect files, search, plan, diff, and verify.",
      );
      return;
    }

    const keywords = intentKeywords(intent);
    const grep = keywords.length
      ? `grep -RIn ${keywords.map(shellQuote).join(" ")} . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=release 2>/dev/null | head -120`
      : "git status --short";

    const searchResult = await invokeCommand(grep, workspace, false);
    const searchOutput = display(searchResult).trim();

    const encodedIntent = b64(intent);
    const encodedSearch = b64(searchOutput.slice(0, 12000));

    const planCmd = `python3 - ${shellQuote(encodedIntent)} ${shellQuote(encodedSearch)} <<'PY'
import base64, json, pathlib, sys, time
intent=base64.b64decode(sys.argv[1]).decode("utf-8", errors="replace")
evidence=base64.b64decode(sys.argv[2]).decode("utf-8", errors="replace")
root=pathlib.Path.cwd()
out=root/".adjutorix"/"objects"
out.mkdir(parents=True, exist_ok=True)
target=out/f"intent-plan-{int(time.time())}.json"
target.write_text(json.dumps({
  "schema": "adjutorix.intent_plan.v2",
  "intent": intent,
  "status": "VERIFY_REQUIRED_BEFORE_APPLY",
  "evidence_preview": evidence.splitlines()[:80],
  "apply_gate": "BLOCKED_UNTIL_VERIFY",
  "created_by": "Adjutorix real agent loop"
}, indent=2), encoding="utf-8")
print(target)
PY`;

    const planResult = await invokeCommand(planCmd, workspace, false);
    const planPath = display(planResult).trim();

    setFeature("plan");
    setFeatureOutput(
      `${planPath}\n\nEvidence preview:\n${searchOutput || "(no matching evidence yet)"}`,
    );

    addChat(
      "adjutorix",
      [
        "Plan created.",
        `Intent: ${intent}`,
        `Evidence hits: ${searchOutput ? searchOutput.split(/\r?\n/g).length : 0}`,
        `Plan object: ${planPath}`,
        "Next: inspect candidate files, edit buffer, run Verify, inspect Diff, then apply only after gate opens.",
      ].join("\n"),
    );
  }, [addChat, files.length, invokeCommand, prompt, verifyReady, workspace]);

  const saveDraft = useCallback(async () => {
    if (!workspace || !activeTab) return;

    const cmd = `python3 - ${shellQuote(activeTab.path)} ${shellQuote(b64(activeTab.content))} <<'PY'
import base64, pathlib, sys, time
path=sys.argv[1]
content=base64.b64decode(sys.argv[2]).decode("utf-8", errors="replace")
root=pathlib.Path.cwd()
out=root/".adjutorix"/"workbench-drafts"
out.mkdir(parents=True, exist_ok=True)
target=out/f"{int(time.time())}__{path.replace('/', '__')}"
target.write_text(content, encoding="utf-8")
print(target)
PY`;

    const result = await invokeCommand(cmd, workspace, false);
    const rendered = display(result);
    setFeature("patch");
    setFeatureOutput(rendered);
    addChat("adjutorix", `Draft saved.\n${rendered}`);
  }, [activeTab, addChat, invokeCommand, workspace]);

  const writeActiveFile = useCallback(async () => {
    if (!workspace || !activeTab) return;

    if (!verifyReady) {
      addChat(
        "adjutorix",
        "Apply is blocked. Run Verify first, inspect Diff, then apply.",
      );
      return;
    }

    const cmd = `python3 - ${shellQuote(activeTab.path)} ${shellQuote(b64(activeTab.content))} <<'PY'
import base64, pathlib, sys
path=sys.argv[1]
content=base64.b64decode(sys.argv[2]).decode("utf-8", errors="replace")
root=pathlib.Path.cwd().resolve()
target=(root/path).resolve()
if root not in target.parents and target != root:
    raise SystemExit("outside workspace")
target.write_text(content, encoding="utf-8")
print(target)
PY`;

    const result = await invokeCommand(cmd, workspace, false);
    addChat(
      "adjutorix",
      `Applied buffer after verify gate.\n${display(result)}`,
    );
    setTabs((current) =>
      current.map((tab) =>
        tab.path === activeTab.path ? { ...tab, dirty: false } : tab,
      ),
    );
  }, [activeTab, addChat, invokeCommand, verifyReady, workspace]);

  const updateBuffer = useCallback(
    (content: string) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.path === activePath ? { ...tab, content, dirty: true } : tab,
        ),
      );
    },
    [activePath],
  );

  const featureTabs: FeatureKey[] = [
    "agent",
    "plan",
    "code",
    "diff",
    "verify",
    "patch",
    "ledger",
    "diagnostics",
    "kernel",
    "package",
    "ipc",
  ];

  return (
    <section
      className="adjutorix-real-agent"
      data-busy={busy ? "true" : "false"}
    >
      <aside className="adjutorix-real-rail">
        <button className="is-active" type="button">
          ⌘
        </button>
        <button type="button">⌕</button>
        <button type="button">⑂</button>
        <button type="button">✓</button>
        <button type="button">◆</button>
      </aside>

      <aside className="adjutorix-real-explorer">
        <header>
          <strong>Explorer</strong>
          <button type="button" onClick={() => void openRepository()}>
            Open
          </button>
        </header>

        <section className="adjutorix-real-workspace">
          <span>Workspace</span>
          <strong>{workspace || "No workspace"}</strong>
          <div>
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void scanWorkspace(pathInput);
              }}
            />
            <button type="button" onClick={() => void scanWorkspace(pathInput)}>
              Load
            </button>
          </div>
        </section>

        <input
          className="adjutorix-real-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search real files..."
        />

        <div className="adjutorix-real-filelist">
          {visibleFiles.length ? (
            visibleFiles.map((file) => (
              <button
                key={file.path}
                className={file.path === activePath ? "is-active" : ""}
                type="button"
                onClick={() => void readFile(file)}
              >
                <strong>{file.name}</strong>
                <span>{file.path}</span>
              </button>
            ))
          ) : (
            <article className="adjutorix-real-start">
              <h2>Start</h2>
              <p>Open folder. Ask Adjutorix. Verify. Patch.</p>
              <button
                type="button"
                onClick={() => void scanWorkspace(pathInput || workspace)}
              >
                Scan
              </button>
            </article>
          )}
        </div>
      </aside>

      <main className="adjutorix-real-main">
        <header className="adjutorix-real-topbar">
          <div>
            <strong>ADJUTORIX</strong>
            <span>real governed mutation IDE</span>
          </div>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createPlan();
            }}
            placeholder="Ask Adjutorix what to change..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Run agent
          </button>
          <button
            type="button"
            onClick={() => void runFeatureCommand("Verify", "pnpm run verify")}
          >
            Verify
          </button>
          <button
            type="button"
            onClick={() =>
              void runFeatureCommand(
                "Diff",
                "git diff --stat && git diff | head -260",
              )
            }
          >
            Diff
          </button>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new Event("adjutorix:product-command-deck:toggle"),
              )
            }
          >
            Power
          </button>
        </header>

        <nav className="adjutorix-real-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.path}
              className={tab.path === activePath ? "is-active" : ""}
              type="button"
              onClick={() => setActivePath(tab.path)}
            >
              {basename(tab.path)}
              {tab.dirty ? " •" : ""}
            </button>
          ))}
        </nav>

        <section className="adjutorix-real-editor">
          <header>
            <strong>{activeTab?.path ?? "No file"}</strong>
            <span>{activeTab?.dirty ? "dirty buffer" : "loaded buffer"}</span>
          </header>
          <textarea
            spellCheck={false}
            value={activeTab?.content ?? ""}
            onChange={(event) => updateBuffer(event.target.value)}
          />
        </section>

        <section className="adjutorix-real-terminal">
          <header>
            <strong>Terminal</strong>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  void runFeatureCommand("Terminal", command);
              }}
            />
          </header>
          <div>
            {terminal.map((line, index) => (
              <pre key={index}>{line}</pre>
            ))}
          </div>
        </section>
      </main>

      <aside className="adjutorix-real-side">
        <nav>
          {featureTabs.map((tab) => (
            <button
              key={tab}
              className={feature === tab ? "is-active" : ""}
              type="button"
              onClick={() => setFeature(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <section className="adjutorix-real-chat">
          <p>Adjutorix Agent</p>
          <h2>Tell it what to change.</h2>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: add barcode validation, refactor scanner flow, update tests..."
          />
          <button type="button" onClick={() => void createPlan()}>
            Generate real plan
          </button>
          <div className="adjutorix-real-chatlog">
            {chat.map((message) => (
              <article key={message.id} data-role={message.role}>
                <strong>{message.role}</strong>
                <pre>{message.body}</pre>
              </article>
            ))}
          </div>
        </section>

        <section className="adjutorix-real-actions">
          <h3>{feature}</h3>
          <div>
            {COMMANDS[feature].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() =>
                  void runFeatureCommand(action.label, action.command)
                }
              >
                {action.label}
              </button>
            ))}
            {feature === "agent" && (
              <button
                type="button"
                onClick={() =>
                  void runBridgeFeature(
                    "Runtime snapshot",
                    "runtime.snapshot",
                    'node -e "console.log(JSON.stringify(process.versions,null,2))"',
                  )
                }
              >
                Runtime bridge
              </button>
            )}
            {feature === "kernel" && (
              <button
                type="button"
                onClick={() =>
                  setFeatureOutput(
                    asJson(
                      adjutorixOperatorKernelBridge() ??
                        "No operator kernel bridge",
                    ),
                  )
                }
              >
                Kernel object
              </button>
            )}
            {feature === "patch" && (
              <button type="button" onClick={() => void saveDraft()}>
                Save draft
              </button>
            )}
            {feature === "patch" && (
              <button type="button" onClick={() => void writeActiveFile()}>
                Apply active buffer
              </button>
            )}
          </div>
        </section>

        <section className="adjutorix-real-output">
          <h3>Real output</h3>
          <pre>{featureOutput}</pre>
        </section>

        <section className="adjutorix-real-gate">
          <article data-ok={workspace ? "true" : "false"}>
            <strong>Workspace</strong>
            <span>{workspace ? "ready" : "missing"}</span>
          </article>
          <article data-ok={files.length ? "true" : "false"}>
            <strong>Index</strong>
            <span>{files.length} files</span>
          </article>
          <article data-ok={verifyReady ? "true" : "false"}>
            <strong>Verify gate</strong>
            <span>{verifyReady ? "open" : "required"}</span>
          </article>
          <article data-ok={verifyReady ? "true" : "false"}>
            <strong>Apply gate</strong>
            <span>{verifyReady ? "review then apply" : "blocked"}</span>
          </article>
        </section>
      </aside>

      <footer className="adjutorix-real-status">
        <span>Adjutorix</span>
        <span>{workspace || "No workspace"}</span>
        <span>Files: {files.length}</span>
        <span>Bridge: connected</span>
        <span>Verify: {verifyReady ? "open" : "required"}</span>
        <span>Apply: {verifyReady ? "review required" : "blocked"}</span>
      </footer>
    </section>
  );
}
