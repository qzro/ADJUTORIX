import { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";

type Any = Record<string, any>;

type Entry = {
  path: string;
  isDir: boolean;
  size?: number;
};

type BufferState = {
  path: string;
  content: string;
  original: string;
  dirty: boolean;
  language: string;
  openedAt: number;
  savedAt?: number;
};

type SearchHit = {
  path: string;
  reason: "path" | "content";
  line?: number;
  preview: string;
};

type ProblemItem = {
  path: string;
  line: number;
  severity: "info" | "warning" | "error";
  message: string;
};

type OutlineItem = {
  line: number;
  kind: string;
  label: string;
};

type ActivityView = "explorer" | "search" | "scm" | "run" | "agent";
type BottomPanel = "terminal" | "output" | "problems" | "patch" | "raw" | "closed";
type RightPanel = "inspector" | "outline" | "problems" | "patch" | "agent" | "runtime";

type CommandItem = {
  label: string;
  detail: string;
  run: () => void;
};

const MARKER = "ADJUTORIX_NATIVE_IDE_WORKBENCH_V4";

const COMMAND_BRIDGES = [
  "shell.run",
  "shell.execute",
  "terminal.run",
  "terminal.execute",
  "command.run",
  "commands.run",
  "runtime.runCommand",
  "workspace.runCommand",
  "agent.command",
  "agent.submit",
];

function api(): Any | null {
  const w = window as Any;
  return w.adjutorixApi ?? w.adjutorix ?? null;
}

function normalize(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function basename(path: unknown): string {
  const parts = normalize(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? String(path ?? "");
}

function dirname(path: unknown): string {
  const parts = normalize(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function relative(path: unknown, root: unknown): string {
  const p = normalize(path);
  const r = normalize(root);
  if (!r) return p;
  if (p === r) return ".";
  if (p.startsWith(r + "/")) return p.slice(r.length + 1);
  return p;
}

function asRecord(value: unknown): Any {
  return value && typeof value === "object" ? (value as Any) : {};
}

function unwrap(value: unknown): unknown {
  const record = asRecord(value);
  if (record.ok === true && "data" in record) return record.data;
  if (record.ok === true && "snapshot" in record) return record.snapshot;
  if (record.ok === true && "result" in record) return record.result;
  return value;
}

function getFunction(rootApi: Any | null, dotted: string): unknown {
  let current: unknown = rootApi;
  for (const part of dotted.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Any)[part];
  }
  return current;
}

async function call(fn: unknown, payload: Any = {}): Promise<unknown> {
  if (typeof fn !== "function") return null;
  return unwrap(await (fn as (input: Any) => unknown | Promise<unknown>)(payload));
}

async function invokeFirst(rootApi: Any | null, bridges: string[], payloads: Any[]): Promise<unknown> {
  let found = false;
  let lastError: unknown = null;

  for (const bridge of bridges) {
    const fn = getFunction(rootApi, bridge);
    if (typeof fn !== "function") continue;
    found = true;

    for (const payload of payloads) {
      try {
        return await call(fn, payload);
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (!found) throw new Error(`bridge_missing:${bridges.join("|")}`);
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "bridge_call_failed"));
}

function childrenOf(node: Any): unknown[] {
  return [node.children, node.entries, node.items, node.files, node.tree, node.workspaceTree, node.fileTree].find(Array.isArray) ?? [];
}

function pathOf(node: Any): string | null {
  const value = node.path ?? node.fullPath ?? node.absolutePath ?? node.relativePath ?? node.workspacePath ?? node.id;
  return typeof value === "string" && value.trim() ? normalize(value) : null;
}

function dirOf(node: Any): boolean {
  const kind = String(node.kind ?? node.type ?? node.entryType ?? "").toLowerCase();
  return node.isDirectory === true || node.directory === true || kind.includes("dir") || kind.includes("folder") || childrenOf(node).length > 0;
}

function collectEntries(payloads: unknown[]): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    const value = unwrap(node);
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const record = asRecord(value);
    const path = pathOf(record);
    if (path) out.push({ path, isDir: dirOf(record), size: typeof record.size === "number" ? record.size : undefined });

    for (const child of childrenOf(record)) walk(child);
    for (const key of ["workspace", "data", "snapshot", "runtime", "root", "result"]) walk(record[key]);
  };

  walk(payloads);

  const unique = new Map<string, Entry>();
  for (const entry of out) unique.set(`${entry.isDir ? "d" : "f"}:${entry.path}`, entry);
  return Array.from(unique.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function isNoise(path: unknown): boolean {
  const raw = normalize(path);
  const p = `/${raw.toLowerCase()}/`;

  return (
    !raw.trim() ||
    p.includes("/node_modules/") ||
    p.includes("/.git/") ||
    p.includes("/dist/") ||
    p.includes("/build/") ||
    p.includes("/coverage/") ||
    p.includes("/__pycache__/") ||
    p.includes("/.pytest_cache/") ||
    p.includes("/.mypy_cache/") ||
    p.includes("/.ruff_cache/") ||
    p.includes("/.turbo/") ||
    p.includes("/.cache/") ||
    p.includes("/.vite/") ||
    p.includes("/.venv/") ||
    p.includes("/venv/") ||
    p.includes("/site-packages/") ||
    p.includes("/quarantine/") ||
    /(^|\/)\.adjutorix(\/|$)/i.test(raw) ||
    /(^|\/)\.adjutorix-release(\/|$)/i.test(raw)
  );
}

function isBinary(path: unknown): boolean {
  return /\.(png|jpg|jpeg|gif|webp|icns|ico|woff|woff2|ttf|otf|zip|gz|tgz|pdf|mp4|mov|mp3|wav|sqlite|db|lock)$/i.test(normalize(path));
}

function languageFor(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".tsx") || p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".jsx") || p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".sh")) return "shell";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".sql")) return "sql";
  return "plaintext";
}

function score(path: unknown): number {
  const p = normalize(path).toLowerCase();
  const b = basename(p).toLowerCase();
  let s = 0;

  if (p.endsWith("/packages/adjutorix-app/src/renderer/revolutionworkbench.tsx")) s += 400000;
  if (p.endsWith("/packages/adjutorix-app/src/renderer/main.tsx")) s += 390000;
  if (p.endsWith("/packages/adjutorix-app/src/main/index.ts")) s += 380000;
  if (p.includes("/src/renderer/")) s += 90000;
  if (p.includes("/src/main/")) s += 85000;
  if (p.includes("/src/preload/")) s += 80000;
  if (p.includes("/packages/")) s += 45000;
  if (p.includes("/configs/")) s += 22000;
  if (p.includes("/scripts/")) s += 16000;
  if (p.includes("/tests/")) s += 10000;
  if (b === "package.json") s += 55000;
  if (b === "pnpm-workspace.yaml") s += 50000;
  if (b === "readme.md") s += 35000;
  if (p.endsWith(".tsx")) s += 3000;
  if (p.endsWith(".ts")) s += 2500;
  if (p.endsWith(".json")) s += 1400;
  if (p.endsWith(".yaml") || p.endsWith(".yml")) s += 1300;
  if (p.endsWith(".md")) s += 900;
  if (p.endsWith(".py")) s += 900;
  if (p.endsWith(".sh")) s += 700;

  return s - Math.min(p.length, 900);
}

function realFiles(entries: Entry[]): Entry[] {
  return entries
    .filter((entry) => !entry.isDir && !isNoise(entry.path) && !isBinary(entry.path))
    .sort((a, b) => score(b.path) - score(a.path) || a.path.localeCompare(b.path));
}

function chooseRoot(entries: Entry[], payloads: unknown[]): string | null {
  for (const payload of payloads) {
    let found: string | null = null;

    const walk = (node: unknown): void => {
      const value = unwrap(node);
      if (!value || typeof value !== "object" || found) return;
      const record = asRecord(value);

      for (const key of ["rootPath", "workspaceRoot", "workspacePath", "repoPath", "cwd"]) {
        if (typeof record[key] === "string" && record[key].trim()) found = normalize(record[key]);
      }

      if (Array.isArray(value)) value.forEach(walk);
      else Object.values(record).forEach(walk);
    };

    walk(payload);
    if (found) return found;
  }

  const paths = entries.map((entry) => normalize(entry.path));
  for (const anchor of ["/packages/", "/configs/", "/scripts/", "/tests/", "/docs/"]) {
    const match = paths.find((path) => path.includes(anchor));
    if (match) return match.slice(0, match.indexOf(anchor));
  }

  return null;
}

function textFromReadResult(result: unknown): string {
  if (typeof result === "string") return result;
  const record = asRecord(result);
  return String(record.content ?? record.text ?? record.value ?? record.body ?? "");
}

function collectFunctionPaths(rootApi: Any | null): string[] {
  if (!rootApi) return [];

  const out: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, prefix: string[], depth: number): void => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 6) return;
    seen.add(node);

    for (const [key, value] of Object.entries(node as Any)) {
      const next = [...prefix, key];
      if (typeof value === "function") out.push(next.join("."));
      else if (value && typeof value === "object") walk(value, next, depth + 1);
    }
  };

  walk(rootApi, [], 0);
  return out.sort();
}

function makePatch(path: string, before: string, after: string): string {
  if (before === after) return "";

  const oldLines = before.split("\n");
  const newLines = after.split("\n");

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const removed = oldLines.slice(start, oldEnd + 1);
  const added = newLines.slice(start, newEnd + 1);

  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
}

function outlineFor(buffer: BufferState | undefined): OutlineItem[] {
  if (!buffer) return [];

  return buffer.content
    .split("\n")
    .map((line, index): OutlineItem | null => {
      const text = line.trim();
      const ts =
        text.match(/^(export\s+)?(default\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)/) ??
        text.match(/^(export\s+)?class\s+([A-Za-z0-9_$]+)/) ??
        text.match(/^(const|let|var)\s+([A-Za-z0-9_$]+)\s*=/) ??
        text.match(/^type\s+([A-Za-z0-9_$]+)/) ??
        text.match(/^interface\s+([A-Za-z0-9_$]+)/);
      const py = text.match(/^(async\s+)?def\s+([A-Za-z0-9_]+)/) ?? text.match(/^class\s+([A-Za-z0-9_]+)/);
      const md = text.match(/^(#{1,6})\s+(.+)/);

      if (md) return { line: index + 1, kind: "section", label: md[2] ?? text };
      if (py) return { line: index + 1, kind: text.startsWith("class ") ? "class" : "function", label: py[2] ?? py[1] ?? text };
      if (ts) return { line: index + 1, kind: text.startsWith("class ") || text.includes(" class ") ? "class" : "symbol", label: ts[4] ?? ts[2] ?? ts[1] ?? text };

      return null;
    })
    .filter((item): item is OutlineItem => item !== null)
    .slice(0, 300);
}

function localProblems(buffers: Record<string, BufferState>, raw: unknown[]): ProblemItem[] {
  const problems: ProblemItem[] = [];

  for (const buffer of Object.values(buffers)) {
    buffer.content.split("\n").forEach((line, index) => {
      if (/\bFIXME\b|\bBUG\b|\bHACK\b|@ts-ignore|type:\s*ignore/i.test(line)) {
        problems.push({ path: buffer.path, line: index + 1, severity: "warning", message: line.trim().slice(0, 220) });
      }
      if (/throw new Error\(|TODO\(critical\)/i.test(line)) {
        problems.push({ path: buffer.path, line: index + 1, severity: "info", message: line.trim().slice(0, 220) });
      }
    });
  }

  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    const value = unwrap(node);
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const record = asRecord(value);
    const message = record.message ?? record.detail ?? record.error;
    if (typeof message === "string") {
      const path = typeof record.path === "string" ? normalize(record.path) : "runtime";
      const line = typeof record.line === "number" ? record.line : 1;
      problems.push({ path, line, severity: /error|failed|fatal/i.test(message) ? "error" : "info", message: message.slice(0, 240) });
    }

    Object.values(record).forEach(walk);
  };

  raw.forEach(walk);
  return problems.slice(0, 500);
}

function shellQuote(value: unknown): string {
  return "'" + String(value ?? "").replace(/'/g, "'\\''") + "'";
}

export default function RevolutionWorkbench(): JSX.Element {
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, BufferState>>({});
  const [indexed, setIndexed] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [raw, setRaw] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityView>("explorer");
  const [bottom, setBottom] = useState<BottomPanel>("terminal");
  const [right, setRight] = useState<RightPanel>("inspector");
  const [terminalCommand, setTerminalCommand] = useState("pnpm --filter @adjutorix/app run build");
  const [terminalOutput, setTerminalOutput] = useState<unknown>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [agentIntent, setAgentIntent] = useState("Inspect current workspace state and propose the next concrete patch.");

  const files = useMemo(() => realFiles(entries), [entries]);
  const bridgeFunctions = useMemo(() => collectFunctionPaths(api()), [raw]);
  const selectedBuffer = selected ? buffers[selected] : undefined;
  const dirtyBuffers = useMemo(() => Object.values(buffers).filter((buffer) => buffer.dirty), [buffers]);
  const outline = useMemo(() => outlineFor(selectedBuffer), [selectedBuffer]);
  const problems = useMemo(() => localProblems(buffers, raw), [buffers, raw]);

  const addLog = useCallback((message: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${message}`, ...prev].slice(0, 600));
  }, []);

  const openFile = useCallback(
    async (path: string, explicitRoot?: string | null) => {
      const rootApi = api();
      const full = normalize(path);
      const currentRoot = explicitRoot ?? root;
      const relativePath = relative(full, currentRoot);

      try {
        const result = await invokeFirst(
          rootApi,
          ["workspace.readFile", "workspace.file.read", "workspace.fileRead", "workspace.read"],
          [
            { schema: 1, actor: "renderer", source: "ipc", path: relativePath, targetPath: relativePath, relativePath, filePath: relativePath, workspacePath: relativePath },
            { schema: 1, actor: "renderer", source: "ipc", path: full, targetPath: full, relativePath, filePath: full, workspacePath: relativePath },
            { path: relativePath },
            { path: full },
          ],
        );

        const record = asRecord(result);
        const resolved = normalize(typeof record.path === "string" ? record.path : full);
        const content = textFromReadResult(result);

        setSelected(resolved);
        setTabs((prev) => Array.from(new Set([...prev, resolved])));
        setBuffers((prev): Record<string, BufferState> => {
          const existing = prev[resolved];
          return {
            ...prev,
            [resolved]: {
              path: resolved,
              content: existing?.dirty ? existing.content : content,
              original: existing?.dirty ? existing.original : content,
              dirty: existing?.dirty ?? false,
              language: languageFor(resolved),
              openedAt: existing?.openedAt ?? Date.now(),
              savedAt: existing?.savedAt,
            },
          };
        });

        addLog(`OPEN ${relative(resolved, currentRoot)}`);
      } catch (error) {
        addLog(`OPEN FAILED ${relativePath} :: ${String(error)}`);
      }
    },
    [addLog, root],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    const rootApi = api();

    if (!rootApi) {
      addLog("PRELOAD BRIDGE MISSING");
      setBusy(false);
      return;
    }

    const payloads: unknown[] = [];
    for (const bridge of ["runtime.snapshot", "workspace.status", "workspace.tree", "workspace.scan", "diagnostics.runtime", "agent.health", "ledger.current"]) {
      try {
        payloads.push(await call(getFunction(rootApi, bridge), { schema: 1, actor: "renderer", source: "ipc" }));
      } catch (error) {
        payloads.push({ bridge, error: String(error) });
      }
    }

    const nextEntries = collectEntries(payloads);
    const nextRoot = chooseRoot(nextEntries, payloads);
    const nextFiles = realFiles(nextEntries);

    setRaw(payloads);
    setEntries(nextEntries);
    setRoot(nextRoot);

    if (selected && isNoise(selected)) {
      setSelected(null);
      setTabs([]);
      setBuffers({});
      addLog(`DROP NON-SOURCE BUFFER ${selected}`);
    }

    if (!selected && nextFiles[0]) {
      await openFile(nextFiles[0].path, nextRoot);
    }

    addLog(`REFRESH ${nextEntries.length} entries / ${nextFiles.length} source files`);
    setBusy(false);
  }, [addLog, openFile, selected]);

  const openWorkspace = useCallback(async () => {
    try {
      await invokeFirst(api(), ["workspace.open", "workspace.openWorkspace"], [{ schema: 1, actor: "renderer", source: "ipc" }, {}]);
      addLog("WORKSPACE OPEN COMPLETE");
      await refresh();
    } catch (error) {
      addLog(`WORKSPACE OPEN FAILED ${String(error)}`);
    }
  }, [addLog, refresh]);

  const saveFile = useCallback(
    async (path: string) => {
      const current = buffers[path];
      if (!current || !current.dirty) return;

      const relativePath = relative(path, root);

      try {
        await invokeFirst(
          api(),
          ["workspace.writeFile", "workspace.saveFile", "workspace.file.write", "workspace.file.save"],
          [
            { schema: 1, actor: "renderer", source: "ipc", path: relativePath, targetPath: relativePath, relativePath, filePath: relativePath, workspacePath: relativePath, content: current.content, text: current.content, value: current.content },
            { path: relativePath, content: current.content },
            { path, content: current.content },
          ],
        );

        setBuffers((prev): Record<string, BufferState> => {
          const existing = prev[path];
          if (!existing) return prev;
          return { ...prev, [path]: { ...existing, original: existing.content, dirty: false, savedAt: Date.now() } };
        });

        addLog(`SAVE ${relativePath}`);
      } catch (error) {
        addLog(`SAVE FAILED ${relativePath} :: ${String(error)}`);
      }
    },
    [addLog, buffers, root],
  );

  const saveAll = useCallback(async () => {
    for (const buffer of Object.values(buffers)) {
      if (buffer.dirty) await saveFile(buffer.path);
    }
  }, [buffers, saveFile]);

  const runCommand = useCallback(
    async (command: string) => {
      const text = command.trim();
      if (!text) return;

      setTerminalCommand(text);
      setBottom("terminal");

      try {
        const result = await invokeFirst(
          api(),
          COMMAND_BRIDGES,
          [
            { schema: 1, actor: "renderer", source: "ipc", cwd: root, command: text, intent: text },
            { cwd: root, command: text },
            { command: text },
            { intent: text },
          ],
        );

        setTerminalOutput(result);
        addLog(`RUN ${text}`);
      } catch (error) {
        const blocked = { status: "blocked", reason: String(error), command: text, requiredBridge: COMMAND_BRIDGES };
        setTerminalOutput(blocked);
        addLog(`RUN BLOCKED ${String(error)}`);
        void navigator.clipboard?.writeText(text).catch(() => undefined);
      }
    },
    [addLog, root],
  );

  const indexFiles = useCallback(async () => {
    setBusy(true);
    let count = 0;
    const already = new Set([...Object.keys(indexed), ...Object.keys(buffers)]);

    for (const file of files.slice(0, 350)) {
      if (already.has(file.path)) continue;

      try {
        const relativePath = relative(file.path, root);
        const result = await invokeFirst(
          api(),
          ["workspace.readFile", "workspace.file.read", "workspace.fileRead", "workspace.read"],
          [
            { schema: 1, actor: "renderer", source: "ipc", path: relativePath, targetPath: relativePath, relativePath, filePath: relativePath, workspacePath: relativePath },
            { path: relativePath },
            { path: file.path },
          ],
        );

        const text = textFromReadResult(result);
        setIndexed((prev) => ({ ...prev, [file.path]: text }));
        already.add(file.path);
        count++;
      } catch {
        // Keep indexing usable even when individual files are denied.
      }
    }

    addLog(`INDEXED ${count} source files`);
    setBusy(false);
  }, [addLog, buffers, files, indexed, root]);

  useEffect(() => {
    void refresh();
    // boot once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selected) void saveFile(selected);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if (event.key === "Escape") setPaletteOpen(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveFile, selected]);

  const searchHits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: SearchHit[] = [];

    for (const file of files) {
      const relPath = relative(file.path, root);
      if (relPath.toLowerCase().includes(q)) hits.push({ path: file.path, reason: "path", preview: relPath });
    }

    const contentSources: Record<string, string> = {};
    for (const [path, buffer] of Object.entries(buffers)) contentSources[path] = buffer.content;
    for (const [path, text] of Object.entries(indexed)) {
      if (!contentSources[path]) contentSources[path] = text;
    }

    for (const [path, text] of Object.entries(contentSources)) {
      const lines = text.split("\n");
      const index = lines.findIndex((line) => line.toLowerCase().includes(q));
      if (index >= 0) hits.push({ path, reason: "content", line: index + 1, preview: (lines[index] ?? "").trim().slice(0, 240) });
    }

    return hits.slice(0, 500);
  }, [buffers, files, indexed, query, root]);

  const visibleFiles = useMemo<Entry[]>(() => {
    if (!query.trim()) return files;
    const seen = new Set<string>();
    const out: Entry[] = [];

    for (const hit of searchHits) {
      const file = files.find((candidate) => candidate.path === hit.path);
      if (file && !seen.has(file.path)) {
        seen.add(file.path);
        out.push(file);
      }
    }

    return out;
  }, [files, query, searchHits]);

  const currentPatch = selectedBuffer ? makePatch(relative(selectedBuffer.path, root), selectedBuffer.original, selectedBuffer.content) : "";
  const allPatch = dirtyBuffers.map((buffer) => makePatch(relative(buffer.path, root), buffer.original, buffer.content)).filter(Boolean).join("\n\n");

  const agentContext = useMemo(() => {
    const current = selectedBuffer
      ? [
          `CURRENT_FILE=${relative(selectedBuffer.path, root)}`,
          "```",
          selectedBuffer.content.slice(0, 12000),
          "```",
        ].join("\n")
      : "CURRENT_FILE=none";

    return [
      "ADJUTORIX_NATIVE_AGENT_CONTEXT",
      `ROOT=${root ?? "unknown"}`,
      `DIRTY_FILES=${dirtyBuffers.map((buffer) => relative(buffer.path, root)).join(", ") || "none"}`,
      `INTENT=${agentIntent}`,
      current,
      allPatch ? `PATCH:\n${allPatch}` : "PATCH=none",
    ].join("\n\n");
  }, [agentIntent, allPatch, dirtyBuffers, root, selectedBuffer]);

  const commandItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { label: "Refresh workspace", detail: "Reload runtime, workspace, diagnostics and ledger evidence", run: () => void refresh() },
      { label: "Index source", detail: "Read source files into searchable local index", run: () => void indexFiles() },
      { label: "Save current file", detail: selected ?? "No selected file", run: () => selected && void saveFile(selected) },
      { label: "Save all dirty files", detail: `${dirtyBuffers.length} dirty`, run: () => void saveAll() },
      { label: "Run build", detail: "pnpm --filter @adjutorix/app run build", run: () => void runCommand("pnpm --filter @adjutorix/app run build") },
      { label: "Run renderer tests", detail: "pnpm --filter @adjutorix/app exec vitest run tests/renderer", run: () => void runCommand("pnpm --filter @adjutorix/app exec vitest run tests/renderer --reporter=verbose") },
      { label: "Run typecheck", detail: "pnpm typecheck", run: () => void runCommand("pnpm typecheck") },
      { label: "Run verify", detail: "bash scripts/verify.sh", run: () => void runCommand("bash scripts/verify.sh") },
      { label: "Copy agent context", detail: "Copy native handoff context", run: () => void navigator.clipboard?.writeText(agentContext).catch(() => undefined) },
    ];

    for (const file of files.slice(0, 80)) {
      items.push({ label: `Open ${basename(file.path)}`, detail: relative(file.path, root), run: () => void openFile(file.path) });
    }

    return items;
  }, [agentContext, dirtyBuffers.length, files, indexFiles, openFile, refresh, root, runCommand, saveAll, saveFile, selected]);

  const filteredCommands = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return commandItems.slice(0, 80);
    return commandItems.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(q)).slice(0, 80);
  }, [commandItems, paletteQuery]);

  const runAgent = useCallback(async () => {
    try {
      const result = await invokeFirst(
        api(),
        ["agent.submit", "agent.command", "workspace.runCommand"],
        [
          { schema: 1, actor: "renderer", source: "ipc", intent: agentIntent, context: agentContext },
          { intent: agentIntent, context: agentContext },
        ],
      );
      setTerminalOutput(result);
      setBottom("output");
      addLog("AGENT HANDOFF SUBMITTED");
    } catch (error) {
      setTerminalOutput({ status: "blocked", reason: String(error), context: agentContext });
      setBottom("output");
      addLog(`AGENT HANDOFF BLOCKED ${String(error)}`);
      void navigator.clipboard?.writeText(agentContext).catch(() => undefined);
    }
  }, [addLog, agentContext, agentIntent]);

  const renderLeft = (): JSX.Element => {
    if (activity === "search") {
      return (
        <div className="grid min-h-0 grid-rows-[96px_minmax(0,1fr)]">
          <div className="border-b border-zinc-800 p-3">
            <div className="mb-2 flex justify-between text-xs">
              <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">Search</span>
              <button onClick={() => void indexFiles()} className="text-emerald-300">Index</button>
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search path + indexed content" className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs outline-none focus:border-emerald-700" />
          </div>
          <div className="overflow-auto p-2">
            {searchHits.map((hit, index) => (
              <button key={`${hit.path}:${index}`} onClick={() => void openFile(hit.path)} className="mb-1 block w-full rounded-md border border-zinc-900 bg-black px-3 py-2 text-left text-xs hover:border-emerald-900">
                <div className="truncate text-emerald-300">{relative(hit.path, root)}{hit.line ? `:${hit.line}` : ""}</div>
                <div className="truncate text-zinc-500">{hit.reason}: {hit.preview}</div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activity === "scm") {
      return (
        <div className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)]">
          <div className="border-b border-zinc-800 p-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Source Control</div>
          <div className="overflow-auto p-2">
            {dirtyBuffers.length === 0 && <div className="p-3 text-xs text-zinc-600">No dirty buffers.</div>}
            {dirtyBuffers.map((buffer) => (
              <button key={buffer.path} onClick={() => setSelected(buffer.path)} className="mb-1 block w-full rounded-md border border-zinc-900 bg-black px-3 py-2 text-left text-xs hover:border-emerald-900">
                <div className="truncate text-amber-300">modified</div>
                <div className="truncate text-zinc-300">{relative(buffer.path, root)}</div>
              </button>
            ))}
            <button onClick={() => setBottom("patch")} className="mt-2 w-full rounded-md bg-zinc-800 px-3 py-2 text-xs hover:bg-zinc-700">Open patch</button>
          </div>
        </div>
      );
    }

    if (activity === "run") {
      const tasks = [
        "pnpm --filter @adjutorix/app run build",
        "pnpm --filter @adjutorix/app exec vitest run tests/renderer --reporter=verbose",
        "pnpm --filter @adjutorix/app exec vitest run tests/main --reporter=verbose",
        "pnpm typecheck",
        "pnpm test",
        "bash scripts/check.sh",
        "bash scripts/verify.sh",
        "bash scripts/smoke.sh",
      ];

      return (
        <div className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)]">
          <div className="border-b border-zinc-800 p-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Run / Tasks</div>
          <div className="overflow-auto p-2">
            {tasks.map((task) => (
              <button key={task} onClick={() => void runCommand(task)} className="mb-1 block w-full rounded-md border border-zinc-900 bg-black px-3 py-2 text-left text-xs hover:border-emerald-900">
                <div className="text-emerald-300">run</div>
                <div className="break-all text-zinc-300">{task}</div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activity === "agent") {
      return (
        <div className="grid min-h-0 grid-rows-[48px_150px_minmax(0,1fr)]">
          <div className="border-b border-zinc-800 p-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Agent</div>
          <div className="border-b border-zinc-800 p-2">
            <textarea value={agentIntent} onChange={(event) => setAgentIntent(event.target.value)} className="h-full w-full resize-none rounded-md border border-zinc-800 bg-black p-2 text-xs outline-none focus:border-emerald-700" />
          </div>
          <div className="overflow-auto p-2">
            <button onClick={() => void runAgent()} className="mb-2 w-full rounded-md bg-emerald-900 px-3 py-2 text-xs hover:bg-emerald-800">Submit handoff</button>
            <button onClick={() => void navigator.clipboard?.writeText(agentContext).catch(() => undefined)} className="mb-2 w-full rounded-md bg-zinc-800 px-3 py-2 text-xs hover:bg-zinc-700">Copy context</button>
            <pre className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-black p-2 text-[11px] leading-4 text-zinc-400">{agentContext.slice(0, 6000)}</pre>
          </div>
        </div>
      );
    }

    return (
      <div className="grid min-h-0 grid-rows-[96px_minmax(0,1fr)]">
        <div className="border-b border-zinc-800 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">Explorer</span>
            <span className="text-zinc-500">{visibleFiles.length}/{files.length}</span>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="filter source tree" className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs outline-none focus:border-emerald-700" />
        </div>
        <div className="overflow-auto p-2">
          {visibleFiles.map((file) => (
            <button key={file.path} onClick={() => void openFile(file.path)} title={file.path} className={["block w-full truncate rounded-md px-2 py-1.5 text-left text-xs", selected === file.path ? "bg-emerald-950 text-emerald-100" : "text-zinc-300 hover:bg-zinc-900"].join(" ")}>
              <span className="mr-2 text-zinc-600">{buffers[file.path]?.dirty ? "●" : buffers[file.path] ? "•" : "·"}</span>
              {relative(file.path, root)}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-zinc-100">
      <div className="grid h-full grid-rows-[42px_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-md border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-[11px] font-bold tracking-wide text-emerald-200">{MARKER}</div>
            <button onClick={() => setPaletteOpen(true)} className="rounded-md border border-zinc-800 bg-black px-3 py-1.5 text-left text-xs text-zinc-400 hover:border-emerald-800">⌘P command palette</button>
            <div className="truncate text-xs text-zinc-500">{root ?? "no workspace root"}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">bridge {bridgeFunctions.length}</div>
            <div className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">dirty {dirtyBuffers.length}</div>
            <button onClick={() => void openWorkspace()} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">Open workspace</button>
            <button onClick={() => void refresh()} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">{busy ? "Working..." : "Refresh"}</button>
            <button onClick={() => void indexFiles()} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">Index</button>
            <button onClick={() => selected && void saveFile(selected)} disabled={!selectedBuffer?.dirty} className="rounded-md bg-emerald-900 px-3 py-1.5 text-xs enabled:hover:bg-emerald-800 disabled:opacity-40">Save</button>
            <button onClick={() => void saveAll()} disabled={dirtyBuffers.length === 0} className="rounded-md bg-emerald-900 px-3 py-1.5 text-xs enabled:hover:bg-emerald-800 disabled:opacity-40">Save all</button>
          </div>
        </header>

        <main className="grid min-h-0 grid-cols-[48px_330px_minmax(0,1fr)_390px]">
          <nav className="flex flex-col items-center gap-2 border-r border-zinc-800 bg-zinc-950 py-2">
            {(["explorer", "search", "scm", "run", "agent"] as const).map((view) => (
              <button key={view} onClick={() => setActivity(view)} className={["h-9 w-9 rounded-md text-xs uppercase", activity === view ? "bg-emerald-950 text-emerald-200" : "bg-black text-zinc-500 hover:bg-zinc-900"].join(" ")} title={view}>
                {view.slice(0, 2)}
              </button>
            ))}
          </nav>

          <aside className="min-h-0 border-r border-zinc-800 bg-zinc-950">{renderLeft()}</aside>

          <section className="grid min-h-0 grid-rows-[36px_28px_minmax(0,1fr)_auto]">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2">
              {tabs.length === 0 ? <span className="text-xs text-zinc-600">No open files</span> : tabs.map((path) => (
                <button key={path} onClick={() => setSelected(path)} className={["h-7 max-w-72 truncate rounded-md px-3 text-xs", selected === path ? "bg-zinc-800 text-zinc-100" : "bg-black text-zinc-400"].join(" ")} title={path}>
                  {buffers[path]?.dirty ? "● " : ""}
                  {basename(path)}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 items-center gap-2 border-b border-zinc-900 bg-black px-3 text-[11px] text-zinc-500">
              <span className="truncate">{selected ? dirname(relative(selected, root)) : "no file"}</span>
              {selectedBuffer && <span className="rounded bg-zinc-900 px-2 py-0.5">{selectedBuffer.language}</span>}
            </div>

            <div className="min-h-0">
              {selectedBuffer ? (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  path={selectedBuffer.path}
                  language={selectedBuffer.language}
                  value={selectedBuffer.content}
                  options={{ automaticLayout: true, fontSize: 13, minimap: { enabled: true }, scrollBeyondLastLine: false, wordWrap: "off", renderWhitespace: "selection" }}
                  onChange={(value) => {
                    const path = selectedBuffer.path;
                    const next = value ?? "";
                    setBuffers((prev): Record<string, BufferState> => {
                      const current = prev[path];
                      if (!current) return prev;
                      return { ...prev, [path]: { ...current, content: next, dirty: next !== current.original } };
                    });
                  }}
                />
              ) : (
                <div className="grid h-full place-items-center text-sm text-zinc-600">Open a source file.</div>
              )}
            </div>

            {bottom !== "closed" && (
              <div className="h-64 border-t border-zinc-800 bg-zinc-950">
                <div className="flex h-8 items-center justify-between border-b border-zinc-800 px-3 text-xs">
                  <div className="flex gap-4">
                    {(["terminal", "output", "problems", "patch", "raw"] as const).map((panel) => (
                      <button key={panel} onClick={() => setBottom(panel)} className={bottom === panel ? "text-emerald-300" : "text-zinc-500"}>{panel}</button>
                    ))}
                  </div>
                  <button onClick={() => setBottom("closed")} className="text-zinc-500">Close</button>
                </div>

                {bottom === "terminal" && (
                  <div className="grid h-[calc(100%-32px)] grid-rows-[44px_minmax(0,1fr)]">
                    <div className="flex gap-2 p-2">
                      <input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs outline-none focus:border-emerald-700" />
                      <button onClick={() => void runCommand(terminalCommand)} className="rounded-md bg-zinc-800 px-3 py-2 text-xs hover:bg-zinc-700">Run</button>
                    </div>
                    <pre className="overflow-auto p-3 text-xs leading-5 text-zinc-300">{JSON.stringify(terminalOutput, null, 2)}</pre>
                  </div>
                )}

                {bottom === "output" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 text-xs leading-5 text-zinc-300">{log.join("\n")}</pre>}
                {bottom === "problems" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 text-xs leading-5 text-zinc-300">{problems.map((p) => `${p.severity.toUpperCase()} ${relative(p.path, root)}:${p.line} ${p.message}`).join("\n") || "No problems."}</pre>}
                {bottom === "patch" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 text-xs leading-5 text-zinc-300">{allPatch || currentPatch || "No patch."}</pre>}
                {bottom === "raw" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 text-xs leading-5 text-zinc-300">{JSON.stringify(raw, null, 2)}</pre>}
              </div>
            )}
          </section>

          <aside className="grid min-h-0 grid-rows-[38px_minmax(0,1fr)] border-l border-zinc-800 bg-zinc-950">
            <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-2">
              {(["inspector", "outline", "problems", "patch", "agent", "runtime"] as const).map((panel) => (
                <button key={panel} onClick={() => setRight(panel)} className={["rounded-md px-2 py-1.5 text-xs", right === panel ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900"].join(" ")}>{panel}</button>
              ))}
            </div>

            <div className="overflow-auto p-3 text-xs">
              {right === "inspector" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="mb-1 text-zinc-500">Current file</div>
                    <div className="break-all text-emerald-300">{selectedBuffer ? relative(selectedBuffer.path, root) : "none"}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-zinc-800 bg-black p-3"><div className="text-zinc-500">entries</div><div>{entries.length}</div></div>
                    <div className="rounded-lg border border-zinc-800 bg-black p-3"><div className="text-zinc-500">files</div><div>{files.length}</div></div>
                    <div className="rounded-lg border border-zinc-800 bg-black p-3"><div className="text-zinc-500">indexed</div><div>{Object.keys(indexed).length}</div></div>
                    <div className="rounded-lg border border-zinc-800 bg-black p-3"><div className="text-zinc-500">problems</div><div>{problems.length}</div></div>
                  </div>
                  <button onClick={() => selectedBuffer && setBuffers((prev) => ({ ...prev, [selectedBuffer.path]: { ...selectedBuffer, content: selectedBuffer.original, dirty: false } }))} disabled={!selectedBuffer?.dirty} className="w-full rounded-md bg-zinc-800 px-3 py-2 text-xs enabled:hover:bg-zinc-700 disabled:opacity-40">Revert current</button>
                </div>
              )}

              {right === "outline" && (
                <div className="space-y-1">
                  {outline.map((item) => (
                    <button key={`${item.line}:${item.label}`} className="block w-full rounded-md bg-black px-3 py-2 text-left hover:bg-zinc-900">
                      <div className="text-emerald-300">{item.kind}</div>
                      <div className="truncate text-zinc-300">{item.label}</div>
                      <div className="text-zinc-600">line {item.line}</div>
                    </button>
                  ))}
                </div>
              )}

              {right === "problems" && (
                <div className="space-y-1">
                  {problems.map((problem, index) => (
                    <button key={`${problem.path}:${problem.line}:${index}`} onClick={() => void openFile(problem.path)} className="block w-full rounded-md border border-zinc-900 bg-black px-3 py-2 text-left hover:border-emerald-900">
                      <div className={problem.severity === "error" ? "text-red-300" : problem.severity === "warning" ? "text-amber-300" : "text-zinc-400"}>{problem.severity}</div>
                      <div className="truncate text-zinc-300">{relative(problem.path, root)}:{problem.line}</div>
                      <div className="text-zinc-500">{problem.message}</div>
                    </button>
                  ))}
                </div>
              )}

              {right === "patch" && <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black p-3 leading-5 text-zinc-300">{currentPatch || "Current file has no patch."}</pre>}

              {right === "agent" && (
                <div className="space-y-3">
                  <textarea value={agentIntent} onChange={(event) => setAgentIntent(event.target.value)} className="h-28 w-full resize-none rounded-md border border-zinc-800 bg-black p-2 text-xs outline-none focus:border-emerald-700" />
                  <button onClick={() => void runAgent()} className="w-full rounded-md bg-emerald-900 px-3 py-2 text-xs hover:bg-emerald-800">Submit handoff</button>
                  <button onClick={() => void navigator.clipboard?.writeText(agentContext).catch(() => undefined)} className="w-full rounded-md bg-zinc-800 px-3 py-2 text-xs hover:bg-zinc-700">Copy context</button>
                  <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black p-3 leading-4 text-zinc-400">{agentContext.slice(0, 8000)}</pre>
                </div>
              )}

              {right === "runtime" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="text-zinc-500">Detected bridge functions</div>
                    <div className="text-emerald-300">{bridgeFunctions.length}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black p-3">
                    {bridgeFunctions.map((bridge) => <div key={bridge} className="break-all py-0.5 text-zinc-300">{bridge}</div>)}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>

      {paletteOpen && (
        <div className="absolute inset-0 z-50 bg-black/70 p-20">
          <div className="mx-auto grid max-h-[70vh] w-[760px] grid-rows-[48px_minmax(0,1fr)] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
            <input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Run command or open file" className="border-b border-zinc-800 bg-black px-4 text-sm outline-none focus:border-emerald-700" />
            <div className="overflow-auto p-2">
              {filteredCommands.map((item) => (
                <button key={`${item.label}:${item.detail}`} onClick={() => { item.run(); setPaletteOpen(false); }} className="mb-1 block w-full rounded-md px-3 py-2 text-left hover:bg-zinc-900">
                  <div className="text-sm text-zinc-100">{item.label}</div>
                  <div className="truncate text-xs text-zinc-500">{item.detail}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
