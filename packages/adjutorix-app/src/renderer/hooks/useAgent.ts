import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

function commitObserved(update: () => void, sync = false): void {
  if (sync) {
    flushSync(update);
    return;
  }

  update();
}

export type AgentLoadState = "idle" | "connecting" | "ready" | "refreshing" | "reconnecting" | "disconnected" | "error";
export type AgentConnectionState = "unknown" | "connecting" | "connected" | "degraded" | "disconnected" | "reconnecting" | "failed";
export type AgentAuthState = "unknown" | "available" | "missing" | "expired" | "invalid" | "not-required";
export type AgentTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted";
export type AgentStreamState = "idle" | "streaming" | "paused" | "completed" | "failed";
export type AgentMessageRole = "user" | "assistant" | "system" | "tool";
export type AgentToolRunState = "idle" | "running" | "succeeded" | "failed";
export type AgentJobPhase = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface AgentHealth {
  level: "healthy" | "degraded" | "unhealthy" | "unknown";
  reasons: string[];
}

export interface AgentSessionIdentity {
  sessionId: string;
  providerLabel: string;
  modelLabel?: string | null;
  endpointLabel?: string | null;
  protocolVersion?: string | null;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAtMs: number;
  streamState?: AgentStreamState;
  requestId?: string | null;
  toolName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AgentToolActivity {
  id: string;
  toolName: string;
  state: AgentToolRunState;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AgentJobSummary {
  id: string;
  title: string;
  phase: AgentJobPhase;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AgentSnapshot {
  identity: AgentSessionIdentity;
  connectionState: AgentConnectionState;
  authState: AgentAuthState;
  trustLevel: AgentTrustLevel;
  health: AgentHealth;
  streamState: AgentStreamState;
  messages: AgentMessage[];
  activeTools: AgentToolActivity[];
  jobs: AgentJobSummary[];
  pendingRequestCount: number;
  metadata?: Record<string, unknown>;
}

export type AgentSessionSnapshot = AgentSnapshot;
export type AgentToolRun = AgentToolActivity;
export type AgentJob = AgentJobSummary;

export interface AgentDerivedState {
  totalMessages: number;
  totalAssistantMessages: number;
  totalUserMessages: number;
  totalToolMessages: number;
  activeToolCount: number;
  runningJobCount: number;
  lastMessage: AgentMessage | null;
  messagesById: Map<string, AgentMessage>;
  activeToolMap: Map<string, AgentToolActivity>;
  jobsById: Map<string, AgentJobSummary>;
}

export interface AgentEvent {
  type:
    | "agent-snapshot"
    | "agent-connected"
    | "agent-disconnected"
    | "agent-health"
    | "agent-message"
    | "agent-message-updated"
    | "agent-stream-state"
    | "agent-tool"
    | "agent-job"
    | "agent-auth"
    | "agent-session-state";
  snapshot?: AgentSnapshot;
  patch?: Partial<AgentSnapshot>;
  message?: AgentMessage;
  tool?: AgentToolActivity;
  job?: AgentJobSummary;
  streamState?: AgentStreamState;
  connectionState?: AgentConnectionState;
  authState?: AgentAuthState;
  trustLevel?: AgentTrustLevel;
  health?: AgentHealth;
}

export interface AgentSendObjectInput {
  content: string;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export type AgentSendInput = string | AgentSendObjectInput;

export interface AgentSendResult {
  requestId?: string | null;
  optimisticMessages?: AgentMessage[];
  snapshot?: AgentSnapshot;
  pendingRequestCount?: number;
}

export interface AgentProvider {
  connect: () => Promise<AgentSnapshot>;
  refresh?: () => Promise<AgentSnapshot>;
  reconnect?: () => Promise<AgentSnapshot>;
  disconnect?: () => Promise<void>;
  sendMessage?: (input: any) => Promise<AgentSendResult | void>;
  subscribe?: (listener: (event: AgentEvent) => void) => () => void;
}

export interface UseAgentOptions {
  autoConnect?: boolean;
  provider: AgentProvider;
}

export interface UseAgentResult {
  state: AgentLoadState;
  snapshot: AgentSnapshot | null;
  derived: AgentDerivedState;
  error: Error | null;
  sendError: Error | null;
  isReady: boolean;
  isBusy: boolean;
  isSending: boolean;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (input: AgentSendInput) => Promise<void>;
  setSnapshot: (snapshot: AgentSnapshot | null) => void;
}

function normalizeMessage(message: AgentMessage): AgentMessage {
  return {
    ...message,
    content: message.content ?? "",
    createdAtMs: Number.isFinite(message.createdAtMs) ? message.createdAtMs : Date.now(),
    streamState: message.streamState ?? "idle",
    requestId: message.requestId ?? null,
    toolName: message.toolName ?? null,
    metadata: { ...(message.metadata ?? {}) },
  };
}

function normalizeTool(tool: AgentToolActivity): AgentToolActivity {
  return {
    ...tool,
    state: tool.state ?? "idle",
    startedAtMs: tool.startedAtMs ?? null,
    endedAtMs: tool.endedAtMs ?? null,
    message: tool.message ?? null,
    metadata: { ...(tool.metadata ?? {}) },
  };
}

function normalizeJob(job: AgentJobSummary): AgentJobSummary {
  return {
    ...job,
    phase: job.phase ?? "unknown",
    createdAtMs: job.createdAtMs ?? null,
    updatedAtMs: job.updatedAtMs ?? null,
    requestId: job.requestId ?? null,
    metadata: { ...(job.metadata ?? {}) },
  };
}

function normalizeSnapshot(snapshot: AgentSnapshot): AgentSnapshot {
  return {
    ...snapshot,
    connectionState: snapshot.connectionState ?? "unknown",
    authState: snapshot.authState ?? "unknown",
    trustLevel: snapshot.trustLevel ?? "unknown",
    health: snapshot.health ?? { level: "unknown", reasons: [] },
    streamState: snapshot.streamState ?? "idle",
    messages: (snapshot.messages ?? []).map(normalizeMessage).sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)),
    activeTools: (snapshot.activeTools ?? []).map(normalizeTool).sort((a, b) => a.id.localeCompare(b.id)),
    jobs: (snapshot.jobs ?? []).map(normalizeJob).sort((a, b) => a.id.localeCompare(b.id)),
    pendingRequestCount: snapshot.pendingRequestCount ?? 0,
    metadata: { ...(snapshot.metadata ?? {}) },
  };
}

function buildDerived(snapshot: AgentSnapshot | null): AgentDerivedState {
  if (!snapshot) {
    return {
      totalMessages: 0,
      totalAssistantMessages: 0,
      totalUserMessages: 0,
      totalToolMessages: 0,
      activeToolCount: 0,
      runningJobCount: 0,
      lastMessage: null,
      messagesById: new Map(),
      activeToolMap: new Map(),
      jobsById: new Map(),
    };
  }

  const messagesById = new Map(snapshot.messages.map((message) => [message.id, message] as const));
  const activeToolMap = new Map(snapshot.activeTools.map((tool) => [tool.id, tool] as const));
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job] as const));

  return {
    totalMessages: snapshot.messages.length,
    totalAssistantMessages: snapshot.messages.filter((item) => item.role === "assistant").length,
    totalUserMessages: snapshot.messages.filter((item) => item.role === "user").length,
    totalToolMessages: snapshot.messages.filter((item) => item.role === "tool").length,
    activeToolCount: snapshot.activeTools.filter((item) => item.state === "running").length,
    runningJobCount: snapshot.jobs.filter((item) => item.phase === "running").length,
    lastMessage: snapshot.messages.reduce((best, message) => { const score = (value: AgentMessage): number => { const raw = value as any; const time = Number(raw.createdAtMs ?? raw.updatedAtMs ?? raw.timestampMs ?? raw.timeMs ?? raw.seq ?? raw.sequence ?? 0); const role = String(raw.role ?? raw.type ?? raw.kind ?? '').toLowerCase(); const roleRank = role.includes('tool') ? 3 : role.includes('assistant') ? 2 : role.includes('user') ? 1 : 0; return time * 10 + roleRank; }; return !best || score(message) >= score(best) ? message : best; }, null as AgentMessage | null),
    messagesById,
    activeToolMap,
    jobsById,
  };
}

function upsertById<T extends { id: string }>(items: T[], next: T, sortFn?: (a: T, b: T) => number): T[] {
  const idx = items.findIndex((item) => item.id === next.id);
  const merged = idx >= 0 ? [...items.slice(0, idx), next, ...items.slice(idx + 1)] : [...items, next];
  return sortFn ? [...merged].sort(sortFn) : merged;
}

function applyAgentEvent(previous: AgentSnapshot | null, event: AgentEvent): AgentSnapshot | null {
  if (event.snapshot) return normalizeSnapshot(event.snapshot);
  if (!previous) return previous;

  switch (event.type) {
    case "agent-connected":
    case "agent-disconnected":
      return normalizeSnapshot({ ...previous, connectionState: event.connectionState ?? previous.connectionState });
    case "agent-health":
      return normalizeSnapshot({ ...previous, health: event.health ?? previous.health, connectionState: event.connectionState ?? previous.connectionState });
    case "agent-auth":
      return normalizeSnapshot({ ...previous, authState: event.authState ?? previous.authState, trustLevel: event.trustLevel ?? previous.trustLevel });
    case "agent-stream-state":
      return normalizeSnapshot({ ...previous, streamState: event.streamState ?? previous.streamState });
    case "agent-session-state":
      return normalizeSnapshot({ ...previous, ...(event.patch ?? {}) });
    case "agent-message":
    case "agent-message-updated":
      return event.message
        ? normalizeSnapshot({ ...previous, messages: upsertById(previous.messages, normalizeMessage(event.message), (a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)) })
        : previous;
    case "agent-tool":
      return event.tool
        ? normalizeSnapshot({ ...previous, activeTools: upsertById(previous.activeTools, normalizeTool(event.tool), (a, b) => a.id.localeCompare(b.id)) })
        : previous;
    case "agent-job":
      return event.job
        ? normalizeSnapshot({ ...previous, jobs: upsertById(previous.jobs, normalizeJob(event.job), (a, b) => a.id.localeCompare(b.id)) })
        : previous;
    default:
      return previous;
  }
}

export function useAgent(options: UseAgentOptions): UseAgentResult {
  const { provider, autoConnect = true } = options;

  const [state, setState] = useState<AgentLoadState>(autoConnect ? "connecting" : "idle");

  const stateRef = useRef(state);

  const setObservedState = (next: typeof state, sync = false): void => {
    stateRef.current = next;
    commitObserved(() => setState(next), sync);
  };
  const [snapshot, setSnapshotState] = useState<AgentSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [sendError, setSendError] = useState<Error | null>(null);
  const sendErrorRef = useRef(sendError);
  const setObservedSendError = (next: typeof sendError, sync = false): void => {
    sendErrorRef.current = next;
    commitObserved(() => setSendError(next), sync);
  };
  const [isSending, setIsSending] = useState(false);

  const requestSeqRef = useRef(0);
  const sendSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setSnapshot = useCallback((next: AgentSnapshot | null) => {
    if (!mountedRef.current) return;
    setSnapshotState(next ? normalizeSnapshot(next) : null);
  }, []);

  const runConnectLike = useCallback(
    async (mode: "connect" | "refresh" | "reconnect") => {
      const requestId = ++requestSeqRef.current;
      setError(null);
      setObservedState(mode === "refresh" ? "refreshing" : mode === "reconnect" ? "reconnecting" : "connecting");

      try {
        const next =
          mode === "refresh" && provider.refresh
            ? await provider.refresh()
            : mode === "reconnect" && provider.reconnect
              ? await provider.reconnect()
              : await provider.connect();

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

  const connect = useCallback(async () => runConnectLike("connect"), [runConnectLike]);
  const refresh = useCallback(async () => runConnectLike("refresh"), [runConnectLike]);
  const reconnect = useCallback(async () => runConnectLike("reconnect"), [runConnectLike]);

  const disconnect = useCallback(async () => {
    try {
      await provider.disconnect?.();
    } finally {
      if (!mountedRef.current) return;
      setSnapshotState((current) => current ? normalizeSnapshot({ ...current, connectionState: "disconnected", streamState: "idle" }) : current);
      setObservedState("disconnected");
    }
  }, [provider]);

  const sendMessage = useCallback(
    async (input: AgentSendInput) => {
      if (!provider.sendMessage) {
        const nextError = new Error("Agent provider does not support sendMessage().");
        setObservedSendError(nextError);
        throw nextError;
      }

      const sendId = ++sendSeqRef.current;
      setObservedSendError(null);
      commitObserved(() => setIsSending(true), true);

      try {
        const raw = await provider.sendMessage(input);
        if (!mountedRef.current || sendId !== sendSeqRef.current) return;

        const result = raw ?? {};
        if (result.snapshot) {
          setSnapshotState(normalizeSnapshot(result.snapshot));
        } else if (result.optimisticMessages?.length || result.pendingRequestCount != null || result.requestId) {
          setSnapshotState((current) => {
            if (!current) return current;
            const messages = [...current.messages];
            for (const message of result.optimisticMessages ?? []) {
              const normalized = normalizeMessage(message);
              const idx = messages.findIndex((item) => item.id === normalized.id);
              if (idx >= 0) messages[idx] = normalized;
              else messages.push(normalized);
            }
            const pendingRequestCount =
              result.pendingRequestCount ??
              (result.optimisticMessages?.length ? Math.max(1, current.pendingRequestCount + 1) : current.pendingRequestCount);
            return normalizeSnapshot({ ...current, messages, pendingRequestCount });
          });
        }
      } catch (cause) {
        if (!mountedRef.current || sendId !== sendSeqRef.current) return;
        const nextError = cause instanceof Error ? cause : new Error(String(cause));
        setObservedSendError(nextError);
        throw nextError;
      } finally {
        if (!mountedRef.current || sendId !== sendSeqRef.current) return;
        setIsSending(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    if (autoConnect) void connect();
  }, [autoConnect, connect]);

  useEffect(() => {
    if (!provider.subscribe) return;
    const unsubscribe = provider.subscribe((event) => {
      if (!mountedRef.current) return;
      setSnapshotState((current) => applyAgentEvent(current, event));
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
    get sendError() {
      return sendErrorRef.current;
    },
    isReady: state === "ready",
    isBusy: state === "connecting" || state === "refreshing" || state === "reconnecting",
    isSending,
    connect,
    refresh,
    reconnect,
    disconnect,
    sendMessage,
    setSnapshot,
  };
}

export default useAgent;
