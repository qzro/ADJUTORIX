// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "./components/AppShell";
import FileTreePane from "./components/FileTreePane";
import MonacoEditorPane from "./components/MonacoEditorPane";
import TerminalPanel from "./components/TerminalPanel";

type AnyRecord = Record<string, any>;

type ActivityItem = {
  id: string;
  title: string;
  message: string;
  level: "info" | "success" | "warn" | "error";
  atMs: number;
};

const ROOT_FILE_NAMES = new Set([
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "tsconfig.base.json",
]);

function asRecord(value: unknown): AnyRecord | null {
  return value !== null && typeof value === "object" ? (value as AnyRecord) : null;
}

function isFn(value: unknown): value is (...args: any[]) => any {
  return typeof value === "function";
}

function unwrapEnvelope(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  if (record.ok === true && "data" in record) return record.data;
  if (record.ok === true && "snapshot" in record) return record.snapshot;
  return value;
}

function currentBridge(): AnyRecord {
  const g = globalThis as AnyRecord;
  const runtime = asRecord(g.__adjutorixRendererRuntime) ?? asRecord(g.adjutorixRuntime);
  return asRecord(g.adjutorix) ?? asRecord(runtime?.bridge) ?? asRecord(runtime?.api) ?? {};
}

function cleanPath(value: string | null | undefined): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function basename(path: string | null | undefined): string {
  const value = cleanPath(path);
  const parts = value.split("/").filter(Boolean);
  return parts[parts.length - 1] || value || "Untitled";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function looksLikeFilePath(value: string): boolean {
  const path = cleanPath(value);
  if (!path || /^https?:\/\//i.test(path) || /\s/.test(path)) return false;
  const leaf = basename(path);
  if (ROOT_FILE_NAMES.has(leaf)) return true;
  return path.includes("/") && /\.[A-Za-z0-9]{1,16}$/.test(leaf);
}

function looksLikeDirectoryPath(value: string): boolean {
  const path = cleanPath(value);
  if (!path || looksLikeFilePath(path)) return false;
  return path.startsWith("/") || /^[A-Za-z]:\//i.test(path) || path.includes("/");
}

function inferRootFromFile(path: string): string | null {
  const value = cleanPath(path);
  const markers = [
    "/packages/",
    "/configs/",
    "/scripts/",
    "/tests/",
    "/docs/",
    "/src/",
    "/dist/",
    "/node_modules/",
    "/.github/",
    "/assets/",
  ];

  for (const marker of markers) {
    const index = value.indexOf(marker);
    if (index > 0) return value.slice(0, index);
  }

  return null;
}

function visitUnknown(value: unknown, visit: (value: unknown, key?: string) => void, key?: string, seen = new WeakSet<object>()): void {
  visit(value, key);

  const unwrapped = unwrapEnvelope(value);
  if (unwrapped !== value) visitUnknown(unwrapped, visit, key, seen);

  if (!unwrapped || typeof unwrapped !== "object") return;
  if (seen.has(unwrapped as object)) return;
  seen.add(unwrapped as object);

  if (Array.isArray(unwrapped)) {
    for (const item of unwrapped) visitUnknown(item, visit, key, seen);
    return;
  }

  for (const [childKey, child] of Object.entries(unwrapped as AnyRecord)) {
    visitUnknown(child, visit, childKey, seen);
  }
}

function collectFilePaths(...inputs: unknown[]): string[] {
  const found = new Set<string>();

  for (const input of inputs) {
    visitUnknown(input, (value) => {
      if (typeof value === "string" && looksLikeFilePath(value)) found.add(cleanPath(value));
    });
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

function findRootPath(inputs: unknown[], paths: string[]): string | null {
  const keys = new Set(["rootPath", "workspaceRoot", "workspacePath", "currentPath", "repoPath", "directory", "folderPath"]);
  const candidates: string[] = [];

  for (const input of inputs) {
    visitUnknown(input, (value, key) => {
      if (typeof value !== "string" || !key || !keys.has(key)) return;
      const clean = cleanPath(value);
      if (looksLikeDirectoryPath(clean)) candidates.push(clean);
      if (looksLikeFilePath(clean)) {
        const inferred = inferRootFromFile(clean);
        if (inferred) candidates.push(inferred);
      }
    });
  }

  if (candidates.length > 0) return candidates[0];

  for (const path of paths) {
    const inferred = inferRootFromFile(path);
    if (inferred) return inferred;
  }

  return null;
}

function relativePath(path: string, rootPath: string | null): string {
  const clean = cleanPath(path);
  const root = cleanPath(rootPath);
  if (root && clean === root) return ".";
  if (root && clean.startsWith(`${root}/`)) return clean.slice(root.length + 1);
  return clean;
}

function inferLanguage(path: string | null): string {
  const p = cleanPath(path).toLowerCase();
  if (p.endsWith(".tsx") || p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".jsx") || p.endsWith(".js")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".sh")) return "shell";
  return "plaintext";
}

function extractTextForPath(path: string, ...inputs: unknown[]): string | null {
  const target = cleanPath(path);
  let fallback: string | null = null;
  let exact: string | null = null;

  const contentKeys = new Set([
    "content",
    "contents",
    "text",
    "value",
    "body",
    "source",
    "preview",
    "previewText",
    "workingContent",
    "currentValue",
  ]);

  for (const input of inputs) {
    visitUnknown(input, (value) => {
      const record = asRecord(unwrapEnvelope(value)) ?? asRecord(value);
      if (!record) return;

      const recordPath = cleanPath(firstString(record.path, record.filePath, record.selectedPath, record.fullPath, record.relativePath));
      const matched = recordPath === target || recordPath.endsWith(`/${relativePath(target, null)}`) || target.endsWith(`/${recordPath}`);

      for (const [key, candidate] of Object.entries(record)) {
        if (!contentKeys.has(key) || typeof candidate !== "string") continue;
        if (matched && candidate.length > 0) exact = candidate;
        if (!fallback && candidate.length > 0 && !looksLikeFilePath(candidate)) fallback = candidate;
      }
    });
  }

  return exact ?? fallback;
}

async function callAny(api: AnyRecord | null, names: string[], arg?: AnyRecord): Promise<unknown> {
  if (!api) return null;

  let lastError: unknown = null;
  for (const name of names) {
    if (!isFn(api[name])) continue;
    try {
      return await api[name](arg ?? {});
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
}

function coercePath(value: unknown): string | null {
  if (typeof value === "string") return cleanPath(value);
  const record = asRecord(value);
  return firstString(record?.path, record?.filePath, record?.selectedPath, record?.fullPath, record?.relativePath);
}

export default function App(): React.JSX.Element {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<AnyRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openedPaths, setOpenedPaths] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [treeQuery, setTreeQuery] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [rawPayload, setRawPayload] = useState<unknown>(null);
  const [rawVisible, setRawVisible] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalLines, setTerminalLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const appendActivity = useCallback((title: string, message: string, level: ActivityItem["level"] = "info") => {
    setActivity((items) => [
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, message, level, atMs: Date.now() },
      ...items,
    ].slice(0, 20));
  }, []);

  const shellAvailable = (() => {
    const bridge = currentBridge();
    const shell = asRecord(bridge.shell) ?? asRecord(bridge.terminal);
    return Boolean(shell && (isFn(shell.run) || isFn(shell.execute) || isFn(shell.start)));
  })();

  const openFile = useCallback(async (pathLike: unknown, ...seedInputs: unknown[]) => {
    const path = coercePath(pathLike);
    if (!path || !looksLikeFilePath(path)) return;

    setSelectedPath(path);
    setOpenedPaths((current) => Array.from(new Set([...current, path])));

    const bridge = currentBridge();
    const workspace = asRecord(bridge.workspace);
    const outputs: unknown[] = [];

    for (const [method, arg] of [
      ["read", { path, filePath: path, selectedPath: path }],
      ["readFile", { path, filePath: path, selectedPath: path }],
      ["preview", { path, filePath: path, selectedPath: path }],
      ["file", { path, filePath: path, selectedPath: path }],
      ["load", { path, filePath: path, selectedPath: path }],
    ] as Array<[string, AnyRecord]>) {
      if (!isFn(workspace?.[method])) continue;
      try {
        outputs.push(await workspace[method](arg));
      } catch {
        // Keep trying alternate bridge names.
      }
    }

    const text = extractTextForPath(path, ...outputs, ...seedInputs, rawPayload) ?? "";
    setBuffers((current) => ({ ...current, [path]: text }));
    appendActivity("File opened", relativePath(path, rootPath), "success");
  }, [appendActivity, rawPayload, rootPath]);

  const refreshWorkspace = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const bridge = currentBridge();
    const workspace = asRecord(bridge.workspace);
    const runtime = asRecord(bridge.runtime);
    const diagnostics = asRecord(bridge.diagnostics);
    const outputs: unknown[] = [];

    for (const [api, methods] of [
      [runtime, ["snapshot", "load", "status"]],
      [workspace, ["load", "health", "status", "current"]],
      [diagnostics, ["runtime", "load", "observability"]],
    ] as Array<[AnyRecord | null, string[]]>) {
      try {
        const output = await callAny(api, methods, {});
        if (output) outputs.push(output);
      } catch (error) {
        outputs.push({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    const paths = collectFilePaths(...outputs);
    const root = findRootPath(outputs, paths);
    const nextEntries = paths.map((path) => ({
      id: path,
      path,
      relativePath: relativePath(path, root),
      name: basename(path),
      type: "file",
    }));

    setRawPayload(outputs);
    setRootPath(root);
    setEntries(nextEntries);

    const preferred =
      paths.find((path) => /configs\/runtime\/limits\.json$/i.test(path)) ??
      paths.find((path) => /package\.json$/i.test(path)) ??
      paths.find((path) => /README\.md$/i.test(path)) ??
      paths[0] ??
      null;

    if (preferred) {
      await openFile(preferred, ...outputs);
    }

    appendActivity("Workspace refreshed", `${paths.length} files surfaced`, "success");
    setLoading(false);
  }, [appendActivity, openFile]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const openWorkspace = useCallback(async () => {
    const workspace = asRecord(currentBridge().workspace);
    if (!isFn(workspace?.open)) {
      setErrorMessage("workspace.open is not exposed by preload bridge.");
      appendActivity("Open workspace unavailable", "No workspace.open bridge method.", "warn");
      return;
    }

    try {
      const output = await workspace.open({});
      setRawPayload(output);
      await refreshWorkspace();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [appendActivity, refreshWorkspace]);

  const revealPath = useCallback(async (pathLike: unknown) => {
    const path = coercePath(pathLike) ?? selectedPath;
    if (!path) return;

    const workspace = asRecord(currentBridge().workspace);
    if (!isFn(workspace?.reveal)) {
      appendActivity("Reveal unavailable", "No workspace.reveal bridge method.", "warn");
      return;
    }

    await workspace.reveal({ path, filePath: path, selectedPath: path });
  }, [appendActivity, selectedPath]);

  const runTerminal = useCallback(async () => {
    const command = terminalInput.trim();
    if (!command) return;

    const bridge = currentBridge();
    const shell = asRecord(bridge.shell) ?? asRecord(bridge.terminal);

    if (!shellAvailable || !shell) {
      setTerminalLines((lines) => [
        ...lines,
        { kind: "system", text: "Terminal unavailable: no real shell bridge is exposed.", atMs: Date.now() },
      ]);
      return;
    }

    setTerminalLines((lines) => [...lines, { kind: "command", text: command, atMs: Date.now() }]);

    try {
      const output = await callAny(shell, ["run", "execute", "start"], { command, cwd: rootPath });
      const text = typeof output === "string" ? output : extractTextForPath(selectedPath ?? "", output) ?? JSON.stringify(output ?? {}, null, 2);
      setTerminalLines((lines) => [...lines, { kind: "stdout", text, atMs: Date.now() }]);
      setTerminalInput("");
    } catch (error) {
      setTerminalLines((lines) => [
        ...lines,
        { kind: "stderr", text: error instanceof Error ? error.message : String(error), atMs: Date.now() },
      ]);
    }
  }, [rootPath, selectedPath, shellAvailable, terminalInput]);

  const activeContent = selectedPath ? buffers[selectedPath] ?? "" : "";
  const matchedPaths = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (!query) return [];
    return entries
      .map((entry) => String(entry.path ?? ""))
      .filter((path) => path.toLowerCase().includes(query) || (buffers[path] ?? "").toLowerCase().includes(query))
      .slice(0, 25);
  }, [buffers, entries, globalSearch]);

  const diagnostics = errorMessage
    ? [{ id: "app-error", severity: "error", message: errorMessage, line: 1, column: 1, source: "renderer" }]
    : [];

  const leftRail = (
    <div className="h-full min-h-0 p-2">
      <FileTreePane
        title="Files"
        subtitle={rootPath ? relativePath(rootPath, null) : "Open a workspace"}
        health={errorMessage ? "degraded" : "healthy"}
        loading={loading}
        rootPath={rootPath ?? "workspace"}
        entries={entries}
        files={entries}
        selectedPath={selectedPath}
        openedPaths={openedPaths}
        filterQuery={treeQuery}
        showHidden={false}
        showIgnored={false}
        onFilterQueryChange={setTreeQuery}
        onSelectPath={openFile}
        onPathSelected={openFile}
        onOpenPath={openFile}
        onOpenFile={openFile}
        onFileOpen={openFile}
        onRevealPath={revealPath}
        onRefreshRequested={refreshWorkspace}
        onRefresh={refreshWorkspace}
      />
    </div>
  );

  const primaryContent = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Workbench</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100">
            {selectedPath ? relativePath(selectedPath, rootPath) : "No file selected"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
            placeholder="Search files"
            className="h-10 w-64 rounded-xl border border-zinc-800 bg-black/30 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-700"
          />
          <button type="button" onClick={refreshWorkspace} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
            Refresh
          </button>
          <button type="button" onClick={openWorkspace} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
            Open
          </button>
          <button
            type="button"
            onClick={() => setTerminalOpen((value) => !value)}
            disabled={!shellAvailable}
            className={`rounded-xl border px-3 py-2 text-sm ${
              shellAvailable
                ? "border-zinc-700 bg-zinc-900 text-zinc-100"
                : "cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-500"
            }`}
          >
            {shellAvailable ? "Terminal" : "Terminal unavailable"}
          </button>
          <button type="button" onClick={() => setRawVisible((value) => !value)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400">
            Inspect raw
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-rose-800/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {errorMessage}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <div className="flex min-h-11 items-center gap-2 border-b border-zinc-800 px-3">
          {openedPaths.length === 0 ? (
            <span className="text-sm text-zinc-500">No open tabs</span>
          ) : (
            openedPaths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => openFile(path)}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  path === selectedPath ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"
                }`}
              >
                {basename(path)}
              </button>
            ))
          )}
        </div>

        <div className="min-h-0 flex-1">
          <MonacoEditorPane
            path={selectedPath}
            title={basename(selectedPath)}
            language={inferLanguage(selectedPath)}
            baselineContent={activeContent}
            workingContent={activeContent}
            currentValue={activeContent}
            value={activeContent}
            diagnostics={diagnostics}
            readOnly={!selectedPath}
            loading={loading}
            trustLevel="trusted"
            reviewState="none"
            contentSource="working"
            showMinimap={true}
            wordWrap="off"
            onChangeWorkingContent={(next) => {
              if (!selectedPath) return;
              setBuffers((current) => ({ ...current, [selectedPath]: next }));
            }}
            onSaveRequested={() => appendActivity("Save requested", "Save bridge is not wired in this renderer cut.", "warn")}
            onRevealRequested={() => void revealPath(selectedPath)}
            onRefreshRequested={() => selectedPath && void openFile(selectedPath)}
          />
        </div>
      </div>

      <div className="grid h-40 min-h-40 grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Search</div>
          {matchedPaths.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No active search results.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {matchedPaths.map((path) => (
                <button key={path} type="button" onClick={() => openFile(path)} className="block w-full truncate rounded-lg bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-200">
                  {relativePath(path, rootPath)}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Problems</div>
          {diagnostics.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No renderer problems surfaced.</p>
          ) : (
            diagnostics.map((item) => <p key={item.id} className="mt-3 text-sm text-rose-200">{item.message}</p>)
          )}
        </section>

        <section className="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Activity</div>
          {activity.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No activity yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {activity.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-lg bg-zinc-900 px-3 py-2">
                  <div className="text-sm font-medium text-zinc-100">{item.title}</div>
                  <div className="text-xs text-zinc-500">{item.message}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {rawVisible && (
        <div className="max-h-64 overflow-auto rounded-2xl border border-zinc-800 bg-black/40 p-4">
          <div className="mb-3 text-xs uppercase tracking-[0.24em] text-zinc-500">Inspect raw</div>
          <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-zinc-300">
            {JSON.stringify(rawPayload ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );

  const bottomPanel = terminalOpen ? (
    <TerminalPanel
      title="Terminal"
      subtitle={shellAvailable ? "Real shell bridge detected." : "No fake terminal: bridge unavailable."}
      trustLevel="trusted"
      shellStatus={shellAvailable ? "ready" : "failed"}
      runState="idle"
      shellLabel={shellAvailable ? "bridge shell" : "unavailable"}
      cwd={rootPath}
      commandInput={terminalInput}
      history={terminalLines}
      canRun={shellAvailable}
      canClear={true}
      onCommandInputChange={setTerminalInput}
      onRunRequested={runTerminal}
      onClearRequested={() => setTerminalLines([])}
    />
  ) : null;

  return (
    <AppShell
      appTitle="Adjutorix Workbench"
      subtitle={rootPath ? `Workspace · ${basename(rootPath)}` : "Workspace"}
      health={errorMessage ? "degraded" : "healthy"}
      currentView="workspace"
      navItems={[{ key: "workspace", label: "Workspace", active: true }]}
      onSelectView={() => undefined}
      leftRailCollapsed={false}
      rightRailCollapsed={true}
      bottomPanelVisible={terminalOpen}
      statusChips={[
        { label: "Root", value: rootPath ? basename(rootPath) : "none", tone: rootPath ? "good" : "warn" },
        { label: "Files", value: String(entries.length), tone: entries.length > 0 ? "good" : "warn" },
        { label: "Tabs", value: String(openedPaths.length), tone: openedPaths.length > 0 ? "good" : "neutral" },
        { label: "Terminal", value: shellAvailable ? "available" : "disabled", tone: shellAvailable ? "good" : "warn" },
      ]}
      banners={errorMessage ? [{ id: "error", level: "error", title: "Workbench error", message: errorMessage }] : []}
      leftRail={leftRail}
      primaryContent={primaryContent}
      bottomPanel={bottomPanel}
      rightRail={null}
    />
  );
}
