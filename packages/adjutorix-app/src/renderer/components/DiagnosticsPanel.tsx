import React from "react";

/**
 * ADJUTORIX APP — RENDERER / COMPONENTS / DiagnosticsPanel.tsx
 *
 * Canonical normalized diagnostics surface.
 */

export type DiagnosticsHealth = "healthy" | "degraded" | "unhealthy" | "unknown";
export type DiagnosticsSeverity = "none" | "info" | "warn" | "warning" | "error" | "fatal" | "critical";
export type DiagnosticsPanelView = "overview" | "runtime" | "startup" | "logs" | "crash" | "observability" | "export";
export type DiagnosticsExportPhase = "idle" | "requested" | "running" | "succeeded" | "failed";
export type DiagnosticsLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type DiagnosticsLogTarget = "main" | "observability" | "custom";

export type DiagnosticsMetric = {
  id: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type DiagnosticsLogEntry = {
  seq: number;
  target: DiagnosticsLogTarget;
  level: DiagnosticsLogLevel;
  message: string;
  atMs: number;
};

export type DiagnosticsLogStream = {
  target: DiagnosticsLogTarget;
  entries: DiagnosticsLogEntry[];
  truncated?: boolean;
  requestedLines?: number | null;
  requestedBytes?: number | null;
  lastLoadedAtMs?: number | null;
};

export type NormalizedDiagnosticRange = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type NormalizedDiagnostic = {
  id: string;
  fingerprint?: string;
  severity: "fatal" | "error" | "warning" | "info" | DiagnosticsSeverity;
  category?: string;
  producer?: string;
  sourceLabel?: string;
  message: string;
  code?: string | null;
  filePath?: string | null;
  range?: NormalizedDiagnosticRange | null;
  relatedPaths?: string[];
  tags?: string[];
  jobId?: string | null;
  verifyId?: string | null;
  patchId?: string | null;
  createdAtMs?: number | null;
};

export type DiagnosticsSummary = {
  total: number;
  fatalCount?: number;
  errorCount?: number;
  warningCount?: number;
  infoCount?: number;
  byProducer?: Record<string, number>;
  byCategory?: Record<string, number>;
  byFile?: Record<string, number>;
};

export type DiagnosticsPanelProps = {
  title?: string;
  subtitle?: string;
  loading?: boolean;
  health?: DiagnosticsHealth;

  selectedDiagnosticId?: string | null;
  query?: string;
  severityFilter?: string;
  producerFilter?: string;
  fileFilter?: string | null;
  summary?: DiagnosticsSummary;
  diagnostics?: NormalizedDiagnostic[];

  onQueryChange?: (query: string) => void;
  onSeverityFilterChange?: (severity: string) => void;
  onProducerFilterChange?: (producer: string) => void;
  onFileFilterChange?: (file: string | null) => void;
  onSelectDiagnostic?: (diagnosticId: string) => void;
  onOpenDiagnostic?: (diagnosticId: string) => void;
  onRevealDiagnostic?: (diagnosticId: string) => void;
  onNavigateToDiagnostic?: (diagnosticId: string) => void;
  onRefreshRequested?: () => void;

  /** Legacy diagnostics-cockpit props retained so existing callers keep compiling. */
  severity?: DiagnosticsSeverity;
  activeView?: DiagnosticsPanelView;
  runtimeSnapshot?: Record<string, unknown> | null;
  startupReport?: Record<string, unknown> | null;
  crashContext?: Record<string, unknown> | null;
  observabilityBundle?: Record<string, unknown> | null;
  logsByTarget?: Record<DiagnosticsLogTarget, DiagnosticsLogStream>;
  exportPhase?: DiagnosticsExportPhase;
  exportReady?: boolean;
  exportArtifactPath?: string | null;
  exportError?: string | null;
  metrics?: DiagnosticsMetric[];
  filterQuery?: string;
  selectedLogTarget?: DiagnosticsLogTarget;
  selectedLogSeq?: number | null;
  showOnlyErrors?: boolean;
  onRefresh?: () => void;
  onSetActiveView?: (view: DiagnosticsPanelView) => void;
  onSetFilterQuery?: (query: string) => void;
  onSetSelectedLogTarget?: (target: DiagnosticsLogTarget) => void;
  onSelectLogEntry?: (entry: DiagnosticsLogEntry) => void;
  onToggleShowOnlyErrors?: (value: boolean) => void;
  onExportRequested?: () => void;
  onOpenArtifact?: () => void;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function healthTone(health: DiagnosticsHealth): string {
  if (health === "healthy") return "border-emerald-700/30 bg-emerald-500/10 text-emerald-300";
  if (health === "degraded") return "border-amber-700/30 bg-amber-500/10 text-amber-300";
  if (health === "unhealthy") return "border-rose-700/30 bg-rose-500/10 text-rose-300";
  return "border-zinc-700 bg-zinc-950/60 text-zinc-300";
}

function severityTone(severity: string): string {
  if (severity === "fatal" || severity === "critical") return "border-rose-700/40 bg-rose-500/10 text-rose-200";
  if (severity === "error") return "border-red-700/40 bg-red-500/10 text-red-200";
  if (severity === "warning" || severity === "warn") return "border-amber-700/40 bg-amber-500/10 text-amber-200";
  if (severity === "info") return "border-sky-700/40 bg-sky-500/10 text-sky-200";
  return "border-zinc-800 bg-zinc-950/60 text-zinc-300";
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function locationLabel(diagnostic: NormalizedDiagnostic): string {
  if (!diagnostic.range) return "unranged";
  return `line ${diagnostic.range.start.line} column ${diagnostic.range.start.column}`;
}

export default function DiagnosticsPanel(props: DiagnosticsPanelProps): JSX.Element {
  const health = props.health ?? "unknown";
  const subtitle =
    props.subtitle ??
    "Governed normalized diagnostics surface";
  const diagnostics = props.diagnostics ?? [];
  const query = props.query ?? props.filterQuery ?? "";
  const selectedId = props.selectedDiagnosticId ?? diagnostics[0]?.id ?? null;
  const selected = diagnostics.find((diagnostic) => diagnostic.id === selectedId) ?? null;

  const summary: DiagnosticsSummary =
    props.summary ?? {
      total: diagnostics.length,
      fatalCount: diagnostics.filter((diagnostic) => diagnostic.severity === "fatal").length,
      errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning" || diagnostic.severity === "warn").length,
      infoCount: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
      byProducer: {},
      byCategory: {},
      byFile: {},
    };

  const files = unique(
    [
      ...Object.keys(summary.byFile ?? {}),
      ...diagnostics.map((diagnostic) => diagnostic.filePath).filter((path): path is string => Boolean(path)),
    ],
  );

  const producers = unique(
    [
      ...Object.keys(summary.byProducer ?? {}),
      ...diagnostics.map((diagnostic) => diagnostic.producer).filter((producer): producer is string => Boolean(producer)),
    ],
  );

  const categories = unique(
    [
      ...Object.keys(summary.byCategory ?? {}),
      ...diagnostics.map((diagnostic) => diagnostic.category).filter((category): category is string => Boolean(category)),
    ],
  );

  const selectedActionId = selected?.id ?? selectedId ?? diagnostics[0]?.id ?? "";

  const requestRefresh = props.onRefreshRequested ?? props.onRefresh;
  const changeQuery = (value: string): void => {
    props.onQueryChange?.(value);
    props.onSetFilterQuery?.(value);
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Normalized evidence</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">Diagnostic panel</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em]", healthTone(health))}>
              {health}
            </span>
            <button
              type="button"
              onClick={requestRefresh}
              disabled={!requestRefresh}
              className={cx(
                "rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
                !requestRefresh && "cursor-not-allowed opacity-40",
              )}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Total</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{summary.total}</div>
          </div>
          <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Errors</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{summary.errorCount ?? 0}</div>
          </div>
          <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Producers</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{producers.length}</div>
          </div>
          <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Files</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{files.length}</div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <label className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5 xl:w-[32rem]">
            <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">Query</span>
            <input
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Filter normalized diagnostic evidence"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => props.onSeverityFilterChange?.("error")} className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300">
              Severity {props.severityFilter ?? "all"}
            </button>
            <button type="button" onClick={() => props.onProducerFilterChange?.(producers[0] ?? "all")} className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300">
              Producer {props.producerFilter ?? "all"}
            </button>
            <button type="button" onClick={() => props.onFileFilterChange?.(files[0] ?? null)} className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-300">
              File {props.fileFilter ?? "all"}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {props.loading ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-300">
            Hydrating diagnostic panel…
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40">
              <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                Normalized diagnostic list
              </div>
              <div className="space-y-3 p-3">
                {diagnostics.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/30 p-4 text-sm text-zinc-500">
                    No normalized diagnostic records are present.
                  </div>
                ) : (
                  diagnostics.map((diagnostic) => (
                    <button
                      type="button"
                      key={diagnostic.id}
                      onClick={() => props.onSelectDiagnostic?.(diagnostic.id)}
                      className={cx(
                        "block w-full rounded-2xl border px-4 py-3 text-left transition",
                        diagnostic.id === selectedId
                          ? "border-zinc-600 bg-zinc-800/80"
                          : "border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]", severityTone(String(diagnostic.severity)))}>
                          {diagnostic.severity}
                        </span>
                        {diagnostic.sourceLabel ? <span className="text-xs text-zinc-400">{diagnostic.sourceLabel}</span> : null}
                        {diagnostic.producer ? <span className="text-xs text-zinc-500">{diagnostic.producer}</span> : null}
                        {diagnostic.category ? <span className="text-xs text-zinc-500">{diagnostic.category}</span> : null}
                      </div>

                      <div className="mt-2 text-sm font-medium text-zinc-100">{diagnostic.message}</div>

                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                        {diagnostic.code ? <span>{diagnostic.code}</span> : null}
                        <span>{locationLabel(diagnostic)}</span>
                        {diagnostic.jobId ? <span>{diagnostic.jobId}</span> : null}
                        {diagnostic.verifyId ? <span>{diagnostic.verifyId}</span> : null}
                        {diagnostic.patchId ? <span>{diagnostic.patchId}</span> : null}
                      </div>

                      {diagnostic.relatedPaths?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                          {diagnostic.relatedPaths.map((path) => (
                            <span key={path}>{path}</span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40">
                <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                  File identity
                </div>
                <div className="space-y-2 p-4 text-xs text-zinc-400">
                  {files.length > 0 ? files.map((file) => <div key={file}>{file}</div>) : <div>No file-bound records.</div>}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40">
                <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                  Category and producer facts
                </div>
                <div className="space-y-2 p-4 text-xs text-zinc-400">
                  {categories.map((category) => <div key={category}>{category}</div>)}
                  {producers.map((producer) => <div key={producer}>{producer}</div>)}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40">
                <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
                  Selected diagnostic actions
                </div>
                <div className="flex flex-wrap gap-2 p-4">
                  <button
                    type="button"
                    onClick={() => selectedActionId && props.onOpenDiagnostic?.(selectedActionId)}
                    disabled={!selectedActionId || !props.onOpenDiagnostic}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Open diagnostic
                  </button>
                  <button
                    type="button"
                    onClick={() => selectedActionId && props.onRevealDiagnostic?.(selectedActionId)}
                    disabled={!selectedActionId || !props.onRevealDiagnostic}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reveal diagnostic
                  </button>
                  <button
                    type="button"
                    onClick={() => selectedActionId && props.onNavigateToDiagnostic?.(selectedActionId)}
                    disabled={!selectedActionId || !props.onNavigateToDiagnostic}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Navigate to diagnostic
                  </button>
                </div>
                <div className="px-4 pb-4 text-xs text-zinc-500">
                  {selected ? `Selected ${selected.id}` : "No diagnostic selected."}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
