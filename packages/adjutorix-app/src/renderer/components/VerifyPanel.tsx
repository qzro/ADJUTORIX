import React from "react";

export type VerifyPanelPhase =
  | "idle"
  | "requested"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "partial"
  | "cancelled"
  | "stale"
  | "error"
  | "completed"
  | string;

export type VerifyPanelOutcome = "unknown" | "passed" | "failed" | "partial" | "cancelled" | string;
export type VerifyPanelTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted" | string;
export type VerifyPanelSeverity = "none" | "info" | "warn" | "warning" | "error" | "fatal" | string;
export type VerifyCheckStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "warning" | string;

export type VerifyCheckItem = {
  id: string;
  name?: string;
  title?: string;
  status: VerifyCheckStatus;
  severity?: VerifyPanelSeverity;
  category?: string;
  message?: string | null;
  summary?: string | null;
  targetPath?: string | null;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  referenced?: boolean;
  diagnosticsCount?: number;
};

export type VerifyTargetItem = {
  id: string;
  path: string;
  kind?: "file" | "directory" | "workspace" | string;
};

export type VerifyEvidenceItem = {
  id: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad" | string;
};

export type VerifyArtifactItem = {
  id: string;
  label: string;
  kind?: string;
  path?: string | null;
};

export type VerifyPanelSummary = {
  totalChecks?: number;
  passedChecks?: number;
  warningChecks?: number;
  failedChecks?: number;
  replayChecks?: number;
};

export type VerifyPanelProps = {
  title?: string;
  subtitle?: string;
  loading?: boolean;
  health?: string;
  phase?: VerifyPanelPhase;
  status?: string;
  outcome?: VerifyPanelOutcome;
  trustLevel?: VerifyPanelTrustLevel;
  verifyId?: string | null;
  patchId?: string | null;
  relatedPatchId?: string | null;
  activeJobId?: string | null;
  previewHash?: string | null;
  verifiedPreviewHash?: string | null;
  requestHash?: string | null;
  applyReadinessImpact?: string | null;
  canBindToPatch?: boolean;
  boundToPatchReview?: boolean;
  replayable?: boolean;
  targets?: VerifyTargetItem[];
  checks?: VerifyCheckItem[];
  artifacts?: VerifyArtifactItem[];
  notes?: string[];
  evidenceItems?: VerifyEvidenceItem[];
  summary?: VerifyPanelSummary;
  selectedCheckId?: string | null;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  finishedAtMs?: number | null;
  lastStatusAtMs?: number | null;
  statusMessage?: string | null;
  canRunVerify?: boolean;
  canOpenArtifact?: boolean;
  canRevealArtifact?: boolean;
  canRefresh?: boolean;
  onRunRequested?: () => void;
  onRunVerifyRequested?: () => void;
  onRefreshRequested?: () => void;
  onBindToPatchRequested?: () => void;
  onSelectCheck?: (check: VerifyCheckItem) => void;
  onOpenArtifactRequested?: (artifact: VerifyArtifactItem) => void;
  onRevealArtifactRequested?: (artifact: VerifyArtifactItem) => void;
  onFilterQueryChange?: (query: string) => void;
  onToggleShowOnlyFailures?: (value: boolean) => void;
  onToggleShowOnlyAttention?: (value: boolean) => void;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function countBy(checks: VerifyCheckItem[], status: string): number {
  return checks.filter((check) => String(check.status).toLowerCase() === status).length;
}

function countWarnings(checks: VerifyCheckItem[]): number {
  return checks.filter((check) => {
    const status = String(check.status).toLowerCase();
    const severity = String(check.severity ?? "").toLowerCase();
    return status === "warning" || status === "skipped" || severity === "warn" || severity === "warning";
  }).length;
}

function isReplayCheck(check: VerifyCheckItem): boolean {
  return /replay/i.test(`${check.category ?? ""} ${check.name ?? ""} ${check.title ?? ""} ${check.summary ?? ""} ${check.message ?? ""}`);
}

function safeSummary(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/\bpartial\b/gi, "incomplete");
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "passed" || normalized === "ready" || normalized === "healthy") return "border-emerald-700/40 bg-emerald-500/10 text-emerald-300";
  if (normalized === "failed" || normalized === "error" || normalized === "blocked" || normalized === "unhealthy") return "border-rose-700/40 bg-rose-500/10 text-rose-300";
  if (normalized === "warning" || normalized === "warn" || normalized === "partial" || normalized === "degraded" || normalized === "skipped") return "border-amber-700/40 bg-amber-500/10 text-amber-300";
  if (normalized === "running" || normalized === "queued" || normalized === "requested") return "border-sky-700/40 bg-sky-500/10 text-sky-300";
  return "border-zinc-700 bg-zinc-950 text-zinc-300";
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }): JSX.Element {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em]", tone ?? "border-zinc-700 bg-zinc-950 text-zinc-300")}>
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-zinc-50">{value}</div>
    </div>
  );
}

export default function VerifyPanel(props: VerifyPanelProps): JSX.Element {
  const checks = props.checks ?? [];
  const artifacts = props.artifacts ?? [];
  const notes = props.notes ?? [];
  const evidenceItems = props.evidenceItems ?? [];
  const targets = props.targets ?? [];

  const status = text(props.status ?? props.outcome, "unknown");
  const phase = text(props.phase, "idle");
  const health = text(props.health, "unknown");
  const patchId = props.relatedPatchId ?? props.patchId ?? null;
  const finishedAtMs = props.finishedAtMs ?? props.endedAtMs ?? null;

  const totalChecks = props.summary?.totalChecks ?? checks.length;
  const passedChecks = props.summary?.passedChecks ?? countBy(checks, "passed");
  const warningChecks = props.summary?.warningChecks ?? countWarnings(checks);
  const failedChecks = props.summary?.failedChecks ?? countBy(checks, "failed");
  const replayChecks = props.summary?.replayChecks ?? checks.filter(isReplayCheck).length;

  const canRun = props.canRunVerify ?? Boolean(props.onRunVerifyRequested ?? props.onRunRequested);
  const canRefresh = props.canRefresh ?? Boolean(props.onRefreshRequested);
  const canOpen = props.canOpenArtifact ?? Boolean(props.onOpenArtifactRequested);
  const canReveal = props.canRevealArtifact ?? Boolean(props.onRevealArtifactRequested);

  const run = props.onRunVerifyRequested ?? props.onRunRequested;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Verification</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{props.title ?? "Verify"}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{props.subtitle ?? "Governed verification and replay evidence surface"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusClass(health)}>{health}</Badge>
            <Badge tone={statusClass(status)}>{status}</Badge>
            {phase && phase !== "completed" ? <Badge tone={statusClass(phase)}>{phase}</Badge> : null}
            {props.applyReadinessImpact && props.applyReadinessImpact !== "blocked" ? <Badge tone={statusClass(props.applyReadinessImpact)}>{props.applyReadinessImpact}</Badge> : null}
            {props.verifyId ? <Badge tone="border-indigo-700/40 bg-indigo-500/10 text-indigo-300">{props.verifyId}</Badge> : null}
            {props.activeJobId ? <Badge>{props.activeJobId}</Badge> : null}
            {patchId ? <Badge>{patchId}</Badge> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canRun || props.loading}
            onClick={() => run?.()}
            className={cx("rounded-2xl border px-4 py-2 text-sm font-medium", canRun && !props.loading ? "border-indigo-700/40 bg-indigo-500/15 text-indigo-200" : "cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-500")}
          >
            Run
          </button>
          <button
            type="button"
            disabled={!canRefresh}
            onClick={() => props.onRefreshRequested?.()}
            className={cx("rounded-2xl border px-4 py-2 text-sm font-medium", canRefresh ? "border-zinc-700 bg-zinc-950 text-zinc-200" : "cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-500")}
          >
            Refresh
          </button>
          {props.canBindToPatch ? (
            <button type="button" onClick={() => props.onBindToPatchRequested?.()} className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200">
              Bind to patch
            </button>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-5">
        {props.loading ? <p className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">Loading verification evidence.</p> : null}

        <div className="grid gap-3 md:grid-cols-5">
          <Metric label="Total checks" value={totalChecks} />
          <Metric label="Passed" value={passedChecks} />
          <Metric label="Advisory" value={warningChecks} />
          <Metric label="Failed" value={failedChecks} />
          <Metric label="Replay" value={replayChecks} />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Checks</div>
            <div className="mt-3 space-y-3">
              {checks.length === 0 ? (
                <p className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">No checks recorded.</p>
              ) : (
                checks.map((check) => {
                  const name = text(check.title ?? check.name, check.id);
                  const summary = safeSummary(check.summary ?? check.message ?? null);
                  return (
                    <button
                      key={check.id}
                      type="button"
                      onClick={() => props.onSelectCheck?.(check)}
                      className={cx("w-full rounded-2xl border p-3 text-left", props.selectedCheckId === check.id ? "border-indigo-600 bg-indigo-500/10" : "border-zinc-800 bg-zinc-950/60")}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-zinc-100">{name}</div>
                        <Badge tone={statusClass(String(check.status))}>{String(check.status)}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
                        {check.category ? <span>{check.category}</span> : null}
                        {check.targetPath ? <span>{check.targetPath}</span> : null}
                        {typeof check.diagnosticsCount === "number" ? <span>{check.diagnosticsCount} diagnostics</span> : null}
                      </div>
                      {summary ? <p className="mt-2 text-sm leading-6 text-zinc-300">{summary}</p> : null}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Artifacts</div>
              <div className="mt-3 space-y-3">
                {artifacts.length === 0 ? (
                  <p className="text-sm text-zinc-400">No artifacts recorded.</p>
                ) : (
                  artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                      <div className="text-sm font-semibold text-zinc-100">{artifact.label}</div>
                      {artifact.kind ? <div className="mt-1 text-xs text-zinc-500">{artifact.kind}</div> : null}
                      {artifact.path ? <div className="mt-2 break-all text-xs text-zinc-300">{artifact.path}</div> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => props.onOpenArtifactRequested?.(artifact)}
                          className={cx("rounded-xl border px-3 py-1.5 text-xs", canOpen ? "border-zinc-700 text-zinc-200" : "cursor-not-allowed border-zinc-800 text-zinc-500")}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={!canReveal}
                          onClick={() => props.onRevealArtifactRequested?.(artifact)}
                          className={cx("rounded-xl border px-3 py-1.5 text-xs", canReveal ? "border-zinc-700 text-zinc-200" : "cursor-not-allowed border-zinc-800 text-zinc-500")}
                        >
                          Reveal
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Notes</div>
              <div className="mt-3 space-y-2">
                {notes.length === 0 ? (
                  <p className="text-sm text-zinc-400">No verification notes recorded.</p>
                ) : (
                  notes.map((note, index) => (
                    <p key={`${index}-${note}`} className="text-sm leading-6 text-zinc-300">
                      {note}
                    </p>
                  ))
                )}
              </div>
            </section>

            {evidenceItems.length || targets.length || props.statusMessage || props.previewHash || props.verifiedPreviewHash || props.requestHash ? (
              <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Lineage</div>
                <div className="mt-3 space-y-2 text-sm text-zinc-300">
                  {props.statusMessage ? <p>{props.statusMessage}</p> : null}
                  {props.previewHash ? <p>preview: {props.previewHash}</p> : null}
                  {props.verifiedPreviewHash ? <p>verified preview: {props.verifiedPreviewHash}</p> : null}
                  {props.requestHash ? <p>request: {props.requestHash}</p> : null}
                  {props.startedAtMs ? <p>started: {props.startedAtMs}</p> : null}
                  {finishedAtMs ? <p>finished: {finishedAtMs}</p> : null}
                  {evidenceItems.map((item) => (
                    <p key={item.id}>{item.label}: {item.value}</p>
                  ))}
                  {targets.map((target) => (
                    <p key={target.id}>{target.kind ?? "target"}: {target.path}</p>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </section>
  );
}
