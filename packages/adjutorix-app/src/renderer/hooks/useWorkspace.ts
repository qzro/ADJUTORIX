import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

function commitObserved(update: () => void, sync = false): void {
  if (sync) {
    flushSync(update);
    return;
  }

  update();
}

export type WorkspaceLoadState = "idle" | "loading" | "ready" | "refreshing" | "error";
export type WorkspaceTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted";
export type WorkspaceHealthLevel = "healthy" | "degraded" | "unhealthy" | "unknown";
export type WorkspaceIndexState = "unknown" | "idle" | "building" | "ready" | "stale" | "failed";
export type WorkspaceWatchState = "unknown" | "inactive" | "watching" | "degraded" | "failed";
export type WorkspaceEntryKind = "file" | "directory" | "symlink" | "unknown";
export type WorkspaceStatus = "idle" | "loading" | "ready" | "refreshing" | "error" | "degraded";

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: WorkspaceEntryKind;
  parentPath?: string | null;
  extension?: string | null;
  sizeBytes?: number | null;
  hidden?: boolean;
  ignored?: boolean;
  depth?: number;
  childCount?: number | null;
  diagnosticsCount?: number;
  modifiedAtMs?: number | null;
}

export interface WorkspaceDiagnosticsSnapshot {
  total: number;
  fatalCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface WorkspaceHealth {
  level: WorkspaceHealthLevel;
  reasons: string[];
}

export interface WorkspaceIndexStatus {
  state: WorkspaceIndexState;
  progressPct?: number | null;
  updatedAtMs?: number | null;
  issueCount?: number | null;
}

export interface WorkspaceWatcherStatus {
  state: WorkspaceWatchState;
  watchedPaths?: number | null;
  eventLagMs?: number | null;
  lastEventAtMs?: number | null;
}

export interface WorkspaceSnapshot {
  workspaceId: string;
  rootPath: string;
  name: string;
  trustLevel: WorkspaceTrustLevel;
  status?: WorkspaceStatus;
  entries: WorkspaceEntry[];
  selectedPath?: string | null;
  expandedPaths?: string[];
  openedPaths?: string[];
  recentPaths?: string[];
  diagnostics: WorkspaceDiagnosticsSnapshot;
  health: WorkspaceHealth;
  indexStatus: WorkspaceIndexStatus;
  watcherStatus: WorkspaceWatcherStatus;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceDerivedState {
  totalEntries: number;
  totalFiles: number;
  totalDirectories: number;
  visibleEntries: number;
  hiddenEntries: number;
  ignoredEntries: number;
  selectedEntry: WorkspaceEntry | null;
  openedEntrySet: Set<string>;
  recentEntrySet: Set<string>;
  byPath: Map<string, WorkspaceEntry>;
  treeRoots: WorkspaceEntry[];
}

export interface WorkspaceEvent {
  type:
    | "workspace-snapshot"
    | "workspace-updated"
    | "workspace-entry"
    | "workspace-selection"
    | "workspace-selected-path"
    | "workspace-expanded-paths"
    | "workspace-health"
    | "workspace-trust-changed"
    | "workspace-index-updated"
    | "workspace-watcher-updated"
    | "workspace-diagnostics-updated";
  snapshot?: WorkspaceSnapshot;
  entry?: WorkspaceEntry;
  selectedPath?: string | null;
  expandedPaths?: string[];
  health?: WorkspaceHealth;
}

export interface WorkspaceProvider {
  loadWorkspace: () => Promise<WorkspaceSnapshot>;
  refreshWorkspace?: () => Promise<WorkspaceSnapshot>;
  subscribe?: (listener: (event: WorkspaceEvent) => void) => () => void;
  selectPath?: (path: string | null) => Promise<void> | void;
  setExpandedPaths?: (paths: string[]) => Promise<void> | void;
}

export interface UseWorkspaceOptions {
  autoLoad?: boolean;
  provider: WorkspaceProvider;
}

export interface UseWorkspaceResult {
  state: WorkspaceLoadState;
  snapshot: WorkspaceSnapshot | null;
  derived: WorkspaceDerivedState;
  error: Error | null;
  isReady: boolean;
  isBusy: boolean;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  selectPath: (path: string | null) => Promise<void>;
  setExpandedPaths: (paths: string[]) => Promise<void>;
  setSnapshot: (snapshot: WorkspaceSnapshot | null) => void;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function normalizeEntry(entry: WorkspaceEntry): WorkspaceEntry {
  const path = normalizePath(entry.path);
  const parentPath = entry.parentPath ? normalizePath(entry.parentPath) : null;
  return {
    ...entry,
    path,
    parentPath,
    name: entry.name || path.split("/").pop() || path,
    extension: entry.extension ?? (entry.kind === "file" ? path.match(/(\.[^.]+)$/)?.[1] ?? null : null),
    hidden: entry.hidden ?? false,
    ignored: entry.ignored ?? false,
    depth: entry.depth ?? path.split("/").filter(Boolean).length,
    childCount: entry.childCount ?? 0,
  };
}

function normalizeSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const rootPath = normalizePath(snapshot.rootPath);
  const entries = (snapshot.entries ?? []).map(normalizeEntry).sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...snapshot,
    rootPath,
    status: snapshot.status ?? "ready",
    selectedPath: snapshot.selectedPath ? normalizePath(snapshot.selectedPath) : null,
    expandedPaths: (snapshot.expandedPaths ?? []).map(normalizePath),
    openedPaths: (snapshot.openedPaths ?? []).map(normalizePath),
    recentPaths: (snapshot.recentPaths ?? []).map(normalizePath),
    entries,
    health: snapshot.health ?? { level: "unknown", reasons: [] },
    indexStatus: snapshot.indexStatus ?? { state: "unknown" },
    watcherStatus: snapshot.watcherStatus ?? { state: "unknown" },
    diagnostics: snapshot.diagnostics ?? { total: 0, fatalCount: 0, errorCount: 0, warningCount: 0, infoCount: 0 },
    metadata: { ...(snapshot.metadata ?? {}) },
  };
}

function buildDerived(snapshot: WorkspaceSnapshot | null): WorkspaceDerivedState {
  if (!snapshot) {
    return {
      totalEntries: 0,
      totalFiles: 0,
      totalDirectories: 0,
      visibleEntries: 0,
      hiddenEntries: 0,
      ignoredEntries: 0,
      selectedEntry: null,
      openedEntrySet: new Set(),
      recentEntrySet: new Set(),
      byPath: new Map(),
      treeRoots: [],
    };
  }

  const byPath = new Map(snapshot.entries.map((entry) => [entry.path, entry] as const));
  const totalFiles = snapshot.entries.filter((entry) => entry.kind === "file").length;
  const totalDirectories = snapshot.entries.filter((entry) => entry.kind === "directory").length;
  const hiddenEntries = snapshot.entries.filter((entry) => Boolean(entry.hidden)).length;
  const ignoredEntries = snapshot.entries.filter((entry) => Boolean(entry.ignored)).length;

  return {
    totalEntries: snapshot.entries.length,
    totalFiles,
    totalDirectories,
    visibleEntries: snapshot.entries.length - hiddenEntries - ignoredEntries,
    hiddenEntries,
    ignoredEntries,
    selectedEntry: snapshot.selectedPath ? byPath.get(snapshot.selectedPath) ?? null : null,
    openedEntrySet: new Set(snapshot.openedPaths ?? []),
    recentEntrySet: new Set(snapshot.recentPaths ?? []),
    byPath,
    treeRoots: snapshot.entries.filter((entry) => !entry.parentPath || entry.path === snapshot.rootPath),
  };
}

function upsertEntry(entries: WorkspaceEntry[], entry: WorkspaceEntry): WorkspaceEntry[] {
  const next = normalizeEntry(entry);
  const idx = entries.findIndex((item) => item.path === next.path);
  const merged = idx >= 0 ? [...entries.slice(0, idx), next, ...entries.slice(idx + 1)] : [...entries, next];
  return merged.sort((a, b) => a.path.localeCompare(b.path));
}

function applyWorkspaceEvent(previous: WorkspaceSnapshot | null, event: WorkspaceEvent): WorkspaceSnapshot | null {
  if (event.snapshot) return normalizeSnapshot(event.snapshot);
  if (!previous) return previous;

  switch (event.type) {
    case "workspace-entry":
      return event.entry ? normalizeSnapshot({ ...previous, entries: upsertEntry(previous.entries, event.entry) }) : previous;
    case "workspace-selection":
    case "workspace-selected-path":
      return normalizeSnapshot({ ...previous, selectedPath: event.selectedPath ? normalizePath(event.selectedPath) : null });
    case "workspace-expanded-paths":
      return normalizeSnapshot({ ...previous, expandedPaths: (event.expandedPaths ?? []).map(normalizePath) });
    case "workspace-health":
      return normalizeSnapshot({ ...previous, health: event.health ?? previous.health });
    default:
      return previous;
  }
}

export function useWorkspace(options: UseWorkspaceOptions): UseWorkspaceResult {
  const { provider, autoLoad = true } = options;

  const [state, setState] = useState<WorkspaceLoadState>(autoLoad ? "loading" : "idle");

  const stateRef = useRef(state);

  const setObservedState = (next: typeof state, sync = false): void => {
    stateRef.current = next;
    commitObserved(() => setState(next), sync);
  };
  const [snapshot, setSnapshotState] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setSnapshot = useCallback((next: WorkspaceSnapshot | null) => {
    if (!mountedRef.current) return;
    setSnapshotState(next ? normalizeSnapshot(next) : null);
  }, []);

  const runLoad = useCallback(
    async (mode: "load" | "refresh") => {
      const requestId = ++requestSeqRef.current;
      setError(null);
      setObservedState(mode === "refresh" ? "refreshing" : "loading");

      try {
        const next = mode === "refresh" && provider.refreshWorkspace ? await provider.refreshWorkspace() : await provider.loadWorkspace();
        if (!mountedRef.current || requestId !== requestSeqRef.current) return;
        setSnapshotState(normalizeSnapshot(next));
        setObservedState("ready");
      } catch (cause) {
        if (!mountedRef.current || requestId !== requestSeqRef.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setObservedState("error");
      }
    },
    [provider],
  );

  const reload = useCallback(async () => runLoad("load"), [runLoad]);
  const refresh = useCallback(async () => runLoad("refresh"), [runLoad]);

  const selectPath = useCallback(
    async (path: string | null) => {
      const normalized = path ? normalizePath(path) : null;
      if (provider.selectPath) await provider.selectPath(normalized);
      setSnapshotState((current) => current ? normalizeSnapshot({ ...current, selectedPath: normalized }) : current);
    },
    [provider],
  );

  const setExpandedPaths = useCallback(
    async (paths: string[]) => {
      const normalized = paths.map(normalizePath);
      if (provider.setExpandedPaths) await provider.setExpandedPaths(normalized);
      setSnapshotState((current) => current ? normalizeSnapshot({ ...current, expandedPaths: normalized }) : current);
    },
    [provider],
  );

  useEffect(() => {
    if (autoLoad) void reload();
  }, [autoLoad, reload]);

  useEffect(() => {
    if (!provider.subscribe) return;
    const unsubscribe = provider.subscribe((event) => {
      if (!mountedRef.current) return;
      setSnapshotState((current) => applyWorkspaceEvent(current, event));
    });
    return () => unsubscribe?.();
  }, [provider]);

  const derived = useMemo(() => buildDerived(snapshot), [snapshot]);

  return {
    get state() {
      return stateRef.current;
    },
    snapshot,
    derived,
    error,
    isReady: state === "ready",
    isBusy: state === "loading" || state === "refreshing",
    reload,
    refresh,
    selectPath,
    setExpandedPaths,
    setSnapshot,
  };
}

export default useWorkspace;
