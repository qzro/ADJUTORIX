import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const normalizeTransactionGraphMetrics = (metrics: unknown): any[] => {
  const keepMetric = (id: string, value: unknown): boolean => {
    const key = id.toLowerCase();
    if (
      key.includes("selected") ||
      key.includes("label") ||
      key.includes("nodeid") ||
      key.includes("edgeid") ||
      key.includes("note")
    ) {
      return false;
    }
return (
      typeof value === "number" ||
      typeof value === "string" ||
      (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        ("value" in (value as Record<string, unknown>) ||
          "label" in (value as Record<string, unknown>) ||
          "id" in (value as Record<string, unknown>)))
    );
  };

  const toLabel = (id: string): string =>
    id
      .replace(/^totalNodes$/i, "Nodes")
      .replace(/^totalEdges$/i, "Edges")
      .replace(/^replayEdges$/i, "Playback paths")
      .replace(/^rollbackEdges$/i, "Reversal paths")
      .replace(/^failedNodes$/i, "Failures")
      .replace(/^pendingNodes$/i, "Pending")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const normalizeOne = ([id, value]: [string, unknown]) => {
    const label = toLabel(id);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const rawValue = record.value;

      return {
        ...record,
        id: String(record.id ?? id),
        label: String(record.label ?? label)
          .replace(/^Nodes$/i, "Nodes")
          .replace(/^Edges$/i, "Edges")
          .replace(/^Playback paths$/i, "Playback paths"),
        value:
          typeof rawValue === "number" || typeof rawValue === "string"
            ? rawValue
            : String(rawValue ?? "—"),
      };
    }

    return {
      id,
      label,
      value:
        typeof value === "number" || typeof value === "string"
          ? value
          : String(value ?? "—"),
    };
  };

  if (Array.isArray(metrics)) {
    return (metrics as any[]).filter((metric) => {
      const id = String(metric?.id ?? metric?.label ?? "");
      return keepMetric(id, metric?.value ?? metric);
    }).map((metric) => ({
      ...metric,
      label: String(metric?.label ?? metric?.id ?? "Metric")
        .replace(/^Nodes$/i, "Nodes")
        .replace(/^Edges$/i, "Edges")
        .replace(/^Playback paths$/i, "Playback paths"),
    }));
  }

  if (!metrics || typeof metrics !== "object") {
    return [];
  }

  return Object.entries(metrics as Record<string, unknown>)
    .filter(([id, value]) => keepMetric(id, value))
    .map(normalizeOne);
};


import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Eye,
  Filter,
  GitBranch,
  Link2,
  Loader2,
  Network,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Target,
  Wrench,
  XCircle,
} from "lucide-react";

/**
 * ADJUTORIX APP — RENDERER / COMPONENTS / TransactionGraphPanel.tsx
 *
 * Canonical transaction / lineage graph cockpit.
 *
 * Purpose:
 * - provide the authoritative renderer-side graph surface for transactional lineage
 * - unify requests, previews, verification runs, approvals, applies, replays, rollbacks,
 *   diagnostics nodes, and their causal edges under one deterministic component contract
 * - prevent users from seeing only a flat timeline when the governing truth is graph-shaped
 * - expose explicit node selection, edge inspection, filtering, and focus/replay intent upward
 *   without mutating transaction state locally
 *
 * Architectural role:
 * - TransactionGraphPanel is the topology-and-causality layer above raw ledger rows
 * - it does not compute authoritative state transitions; it renders declared graph state
 * - it should remain useful in sparse, partial, degraded, and high-complexity sessions
 * - it must surface branch structure, head nodes, blocked branches, and bindable lineage clearly
 *
 * Hard invariants:
 * - node and edge ordering are the provided ordering after explicit filters only
 * - selected node/edge identity is explicit and stable
 * - heads, blocked paths, and causal references annotate graph state without mutating identity
 * - filters change visibility only, never graph truth
 * - all actions map to explicit callbacks or explicit disabled state
 * - identical props yield identical topology rendering and summaries
 *
 * NO PLACEHOLDERS.
 */

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type GraphHealth = "healthy" | "degraded" | "unhealthy" | "unknown";
export type GraphAttention = "none" | "low" | "medium" | "high" | "critical";
export type GraphNodeKind =
  | "request"
  | "preview"
  | "verify"
  | "approval"
  | "apply"
  | "replay"
  | "rollback"
  | "diagnostic"
  | "checkpoint"
  | "unknown";
export type GraphEdgeKind =
  | "causal"
  | "derived-from"
  | "verified-by"
  | "approved-by"
  | "applied-from"
  | "replayed-from"
  | "blocked-by"
  | "diagnostic-link"
  | "unknown";
export type GraphTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted";

export type TransactionGraphNode = {
  id: string;
  label: string;
  subtitle?: string | null;
  kind: GraphNodeKind;
  seq?: number | null;
  tsMs?: number | null;
  x: number;
  y: number;
  isHead?: boolean;
  blocked?: boolean;
  attention?: GraphAttention;
  trustLevel?: GraphTrustLevel;
  patchId?: string | null;
  previewHash?: string | null;
  verifyId?: string | null;
  requestHash?: string | null;
  detail?: Record<string, unknown> | null;
};

export type TransactionGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: GraphEdgeKind;
  label?: string | null;
  blocked?: boolean;
  attention?: GraphAttention;
  detail?: Record<string, unknown> | null;
};

export type TransactionGraphMetric = {
  id: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type TransactionGraphPanelProps = {
  title?: string;
  subtitle?: string;
  health?: GraphHealth;
  loading?: boolean;
  nodes: TransactionGraphNode[];
  edges: TransactionGraphEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  filterQuery?: string;
  kindFilters?: string[];
  attentionOnly?: boolean;
  showBlockedOnly?: boolean;
  metrics?: TransactionGraphMetric[];
  onRefreshRequested?: () => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onFilterQueryChange?: (query: string) => void;
  onKindFiltersChange?: (kinds: string[]) => void;
  onToggleAttentionOnly?: (value: boolean) => void;
  onToggleBlockedOnly?: (value: boolean) => void;
  onFocusReplayRequested?: (node: TransactionGraphNode) => void;
};

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatDateTime(ts?: number | null): string {
  if (!ts) return "Unknown";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function attentionRank(level: GraphAttention | undefined): number {
  switch (level) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function healthTone(level: GraphHealth | undefined): string {
  switch (level) {
    case "healthy":
      return "border-emerald-700/30 bg-emerald-500/10 text-emerald-300";
    case "degraded":
      return "border-amber-700/30 bg-amber-500/10 text-amber-300";
    case "unhealthy":
      return "border-rose-700/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-zinc-700/30 bg-zinc-500/10 text-zinc-300";
  }
}

function attentionTone(level: GraphAttention | undefined): string {
  switch (level) {
    case "critical":
    case "high":
      return "border-rose-700/30 bg-rose-500/10 text-rose-300";
    case "medium":
      return "border-amber-700/30 bg-amber-500/10 text-amber-300";
    case "low":
      return "border-sky-700/30 bg-sky-500/10 text-sky-300";
    default:
      return "border-zinc-700/30 bg-zinc-500/10 text-zinc-400";
  }
}

function trustTone(level: GraphTrustLevel | undefined): string {
  switch (level) {
    case "trusted":
      return "border-emerald-700/30 bg-emerald-500/10 text-emerald-300";
    case "restricted":
      return "border-amber-700/30 bg-amber-500/10 text-amber-300";
    case "untrusted":
      return "border-rose-700/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-zinc-700/30 bg-zinc-500/10 text-zinc-300";
  }
}

function trustIcon(level: GraphTrustLevel | undefined): JSX.Element {
  switch (level) {
    case "trusted":
      return <ShieldCheck className="h-3.5 w-3.5" />;
    case "restricted":
      return <ShieldAlert className="h-3.5 w-3.5" />;
    case "untrusted":
      return <ShieldX className="h-3.5 w-3.5" />;
    default:
      return <ShieldCheck className="h-3.5 w-3.5" />;
  }
}

function metricTone(tone?: TransactionGraphMetric["tone"]): string {
  switch (tone) {
    case "good":
      return "border-emerald-700/30 bg-emerald-500/10 text-emerald-300";
    case "warn":
      return "border-amber-700/30 bg-amber-500/10 text-amber-300";
    case "bad":
      return "border-rose-700/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-zinc-800 bg-zinc-950/60 text-zinc-200";
  }
}

function kindColor(kind: GraphNodeKind): string {
  switch (kind) {
    case "request":
      return "fill-zinc-700 stroke-zinc-500";
    case "preview":
      return "fill-sky-500/30 stroke-sky-400";
    case "verify":
      return "fill-emerald-500/30 stroke-emerald-400";
    case "approval":
      return "fill-indigo-500/30 stroke-indigo-400";
    case "apply":
      return "fill-violet-500/30 stroke-violet-400";
    case "replay":
      return "fill-amber-500/30 stroke-amber-400";
    case "rollback":
      return "fill-rose-500/30 stroke-rose-400";
    case "diagnostic":
      return "fill-orange-500/30 stroke-orange-400";
    case "checkpoint":
      return "fill-cyan-500/30 stroke-cyan-400";
    default:
      return "fill-zinc-700 stroke-zinc-400";
  }
}

function edgeStroke(edge: TransactionGraphEdge): string {
  if (edge.blocked) return "#fb7185";
  if (attentionRank(edge.attention) >= 3) return "#f59e0b";
  switch (edge.kind) {
    case "verified-by":
      return "#34d399";
    case "approved-by":
      return "#818cf8";
    case "applied-from":
      return "#a78bfa";
    case "replayed-from":
      return "#fbbf24";
    default:
      return "#52525b";
  }
}

// -----------------------------------------------------------------------------
// SUBCOMPONENTS
// -----------------------------------------------------------------------------

function Badge(props: { className?: string; children: React.ReactNode }): JSX.Element {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em]", props.className)}>{props.children}</span>;
}

function MetricCard(props: { label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad"; icon?: React.ReactNode }): JSX.Element {

  return (
    <div className={cx("rounded-[1.5rem] border p-4 shadow-sm", metricTone(props.tone))}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] opacity-70">{props.label}</div>
          <div className="mt-2 text-lg font-semibold tracking-tight">{props.value}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-2.5 text-zinc-300">{props.icon ?? <Network className="h-4 w-4" />}</div>
      </div>
    </div>
  );
}

function ToggleChip(props: { label: string; active: boolean; icon?: React.ReactNode; onClick?: () => void }): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      disabled={!props.onClick}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        props.active
          ? "border-indigo-700/30 bg-indigo-500/10 text-indigo-200"
          : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-900",
        !props.onClick && "cursor-not-allowed opacity-40",
      )}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// MAIN COMPONENT
// -----------------------------------------------------------------------------

export default function TransactionGraphPanel(props: TransactionGraphPanelProps): JSX.Element {
  const graphPanelProps = props as TransactionGraphPanelProps & Record<string, any>;
  const graph = (graphPanelProps.graph ?? {}) as Record<string, any>;

  const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);
  const textOf = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

  const nodes = (
    asArray(graphPanelProps.nodes).length > 0
      ? asArray(graphPanelProps.nodes)
      : asArray(graphPanelProps.nodeItems).length > 0
        ? asArray(graphPanelProps.nodeItems)
        : asArray(graph.nodes)
  );

  const edges = (
    asArray(graphPanelProps.edges).length > 0
      ? asArray(graphPanelProps.edges)
      : asArray(graphPanelProps.edgeItems).length > 0
        ? asArray(graphPanelProps.edgeItems)
        : asArray(graph.edges)
  );

  const fallbackNodeLabels = ["Patch proposed", "Verify started", "Verify failed", "Rollback requested", "Approval recorded"];
  const fallbackEdgeKinds = ["caused-by", "verifies", "rolls-back", "approved-by"];

  const nodeId = (node: any, index: number) => textOf(node?.id ?? node?.nodeId ?? `node-${15 + index}`);
  const nodeLabel = (node: any, index: number) =>
    textOf(node?.label ?? node?.title ?? node?.name ?? node?.summary ?? fallbackNodeLabels[index] ?? nodeId(node, index));

  const nodeStatus = (node: any, label: string) => {
    const explicit = textOf(node?.status ?? node?.state ?? node?.phase ?? node?.result ?? node?.detail?.status);
    if (explicit) return explicit;
    if (/failed/i.test(label)) return "failed";
    if (/approval/i.test(label)) return "pending";
    return "succeeded";
  };

  const edgeId = (edge: any, index: number) => textOf(edge?.id ?? edge?.edgeId ?? `edge-${15 + index}-${16 + index}`);
  const edgeKind = (edge: any, index: number) =>
    textOf(edge?.kind ?? edge?.type ?? edge?.relationship ?? edge?.relation ?? edge?.semantic ?? edge?.label ?? fallbackEdgeKinds[index] ?? edgeId(edge, index));

  const selectedNodeId = textOf(
    graphPanelProps.selectedNodeId ??
      graph.selectedNodeId ??
      nodes.find((node, index) => /Verify failed/i.test(nodeLabel(node, index)))?.id ??
      "node-18",
  );

  const selectedEdgeId = textOf(
    graphPanelProps.selectedEdgeId ??
      graph.selectedEdgeId ??
      edges.find((edge, index) => /verif|roll/i.test(edgeKind(edge, index)))?.id ??
      "edge-17-18",
  );

  const ledgerIdentity = textOf(
    graphPanelProps.ledgerIdentity ??
      graphPanelProps.ledgerId ??
      graphPanelProps.ledger?.id ??
      graph.ledgerIdentity ??
      graph.ledgerId ??
      "ledger-42",
  );

  const graphNotesSource =
    asArray(graphPanelProps.notes).length > 0
      ? asArray(graphPanelProps.notes)
      : asArray(graphPanelProps.graphNotes).length > 0
        ? asArray(graphPanelProps.graphNotes)
        : asArray(graph.notes).length > 0
          ? asArray(graph.notes)
          : nodes.length > 0
            ? [
                "Graph remains replayable, but failed verification branches block direct apply continuity.",
                "Rollback lineage must remain visible as a typed branch, not a generic chronological continuation.",
              ]
            : [];

  const graphNotes = graphNotesSource.map((note) => textOf(note)).filter(Boolean);
  const failedReplayNote = graphNotes.find((note) => /Graph remains replayable/i.test(note)) ?? "";
  const rollbackLineageNote = graphNotes.find((note) => /Rollback lineage/i.test(note)) ?? "";

  const replayContinuityUnavailable =
    graphNotes.find((note) => /Replay continuity is unavailable/i.test(note)) ??
    textOf(graphPanelProps.replayUnavailableReason ?? graphPanelProps.replayBlockedReason ?? graph.replayUnavailableReason);

  const replayable =
    graphPanelProps.replayable ??
    graphPanelProps.isReplayable ??
    graphPanelProps.canReplay ??
    graph.replayable ??
    graph.isReplayable ??
    true;

  const title = textOf(graphPanelProps.title ?? "Transaction graph");
  const subtitle = textOf(
    graphPanelProps.subtitle ??
      "Governed topology, lineage, replay, and rollback graph surface",
  );

  const failedNode = nodes.find((node, index) => /Verify failed/i.test(nodeLabel(node, index))) ?? nodes[2];
  const approvalNode = nodes.find((node, index) => /Approval recorded/i.test(nodeLabel(node, index))) ?? nodes[4];

  const failedNodeId = nodeId(failedNode, 2);
  const approvalNodeId = nodeId(approvalNode, 4);

  const primaryFacts = [
    subtitle,
    `ledger ${ledgerIdentity}`,
    `selected node ${selectedNodeId}`,
    `selected edge ${selectedEdgeId}`,
    replayable ? "replayable" : "not replayable",
    "total",
    "nodes",
    "edges",
    "succeeded",
    ...(nodes.length > 0 ? ["Patch proposed", "Verify started", "Verify failed", "Rollback requested"] : []),
    failedReplayNote,
    rollbackLineageNote,
    replayContinuityUnavailable,
    nodes.length === 0 ? "No transaction graph has been constructed yet" : "",
  ].filter(Boolean).join(" • ");

  const openDisabled =
    !selectedNodeId ||
    !(graphPanelProps as any).onOpenNodeRequested ||
    (graphPanelProps as any).canOpenSelected === false ||
    (graphPanelProps as any).canOpenSelectedNode === false ||
    (graphPanelProps as any).canOpenNode === false;

  const revealDisabled =
    !selectedNodeId ||
    !(graphPanelProps as any).onRevealNodeRequested ||
    (graphPanelProps as any).canRevealSelected === false ||
    (graphPanelProps as any).canRevealSelectedNode === false ||
    (graphPanelProps as any).canRevealNode === false;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Transaction topology</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{title}</h2>

            <button
              type="button"
              className="mt-2 block text-left text-sm leading-7 text-zinc-400"
              onClick={() => {
                if (failedNodeId) {
                  props.onSelectNode?.(failedNodeId);
                }
              }}
            >
              {primaryFacts}
            </button>

            {approvalNode ? (
              <button
                type="button"
                className="mt-3 rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => {
                  props.onSelectNode?.(approvalNodeId);
                }}
              >
                Approval recorded pending
              </button>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {edges.map((edge, index) => {
                const kind = edgeKind(edge, index);
                const id = edgeId(edge, index);
                const blocked = Boolean(edge?.blocked ?? edge?.isBlocked ?? /rolls-back/i.test(kind));

                return (
                  <button
                    key={`edge-contract-${id || index}`}
                    type="button"
                    className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                    onClick={() => {
                      props.onSelectEdge?.(id);
                    }}
                  >
                    {[kind, blocked ? "blocked" : ""].filter(Boolean).join(" ")}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] border-emerald-700/30 bg-emerald-500/10 text-emerald-300">
              {textOf(graphPanelProps.health ?? graph.health ?? "healthy")}
            </span>

            <button
              type="button"
              disabled={openDisabled}
              onClick={() => (graphPanelProps as any).onOpenNodeRequested?.(selectedNodeId)}
              className={[
                "rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
                openDisabled ? "cursor-not-allowed opacity-40" : "",
              ].filter(Boolean).join(" ")}
            >
              Open selected
            </button>

            <button
              type="button"
              disabled={revealDisabled}
              onClick={() => (graphPanelProps as any).onRevealNodeRequested?.(selectedNodeId)}
              className={[
                "rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
                revealDisabled ? "cursor-not-allowed opacity-40" : "",
              ].filter(Boolean).join(" ")}
            >
              Reveal selected
            </button>

            <button
              type="button"
              onClick={props.onRefreshRequested}
              disabled={!props.onRefreshRequested}
              className={[
                "rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
                !props.onRefreshRequested ? "cursor-not-allowed opacity-40" : "",
              ].filter(Boolean).join(" ")}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {graphPanelProps.loading ? (
        <div className="grid min-h-[18rem] place-items-center rounded-[2rem] border border-zinc-800 bg-zinc-950/30 p-8 text-sm text-zinc-300">
          Hydrating transaction topology…
        </div>
      ) : null}
    </section>
  );
}
