import React, { useMemo, useState } from "react";

export type SearchTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted";
export type SearchSeverity = "none" | "info" | "warn" | "error" | "critical";
export type SearchReviewState = "none" | "preview" | "approved" | "verified" | "applied";
export type SearchScope = "workspace" | "open-buffers" | "selected-paths" | "modified-files";

export type SearchResultItem = {
  id: string;
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  previewBefore?: string;
  previewMatch: string;
  previewAfter?: string;
  language?: string | null;
  trustLevel?: SearchTrustLevel;
  diagnosticsSeverity?: SearchSeverity;
  diagnosticsCount?: number;
  reviewState?: SearchReviewState;
  modified?: boolean;
  generated?: boolean;
  ignored?: boolean;

  label?: string;
  description?: string;
  lineNumber?: number;
  kind?: string;
  excerpt?: string;
  matchRanges?: Array<{ start: number; end: number }>;
};

export type SearchPanelProps = {
  title?: string;
  subtitle?: string;
  rootPath?: string | null;
  query?: string;
  replaceQuery?: string;
  regex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  scope?: SearchScope;
  loading?: boolean;
  canSearch?: boolean;
  trustLevel?: SearchTrustLevel;
  health?: "healthy" | "degraded" | "unhealthy" | "unknown";
  indexState?: "ready" | "stale" | "indexing" | "missing" | "unknown";
  resultCount?: number;
  totalResultCount?: number;
  fileCount?: number;
  selectedResultId?: string | null;
  filters?: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    includeIgnored?: boolean;
    includeHidden?: boolean;
  };
  metrics?: {
    indexedFiles?: number;
    searchedFiles?: number;
    contentMatches?: number;
    pathMatches?: number;
  };
  results?: SearchResultItem[];
  showOnlyModified?: boolean;
  showOnlyDiagnostics?: boolean;
  showOnlyReviewRelevant?: boolean;
  onQueryChange?: (value: string) => void;
  onReplaceQueryChange?: (value: string) => void;
  onRegexChange?: (value: boolean) => void;
  onMatchCaseChange?: (value: boolean) => void;
  onWholeWordChange?: (value: boolean) => void;
  onScopeChange?: (value: SearchScope) => void;
  onSearch?: () => void;
  onRefresh?: () => void;
  onRefreshRequested?: () => void;
  onOpenResult?: (result: SearchResultItem) => void;
  onRevealResult?: (result: SearchResultItem) => void;
  onSelectResult?: (id: string) => void;
  onToggleModifiedOnly?: (value: boolean) => void;
  onToggleDiagnosticsOnly?: (value: boolean) => void;
  onToggleReviewRelevantOnly?: (value: boolean) => void;
  onToggleCaseSensitive?: (value: boolean) => void;
  onToggleWholeWord?: (value: boolean) => void;
  onToggleRegex?: (value: boolean) => void;
  onToggleIncludeIgnored?: (value: boolean) => void;
  onToggleIncludeHidden?: (value: boolean) => void;
};

type NormalizedResult = SearchResultItem & {
  displayLabel: string;
  displayLine: number;
  displayColumn: number;
  displayExcerpt: string;
  displayKind: string;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function basename(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function scopeLabel(scope: SearchScope): string {
  switch (scope) {
    case "open-buffers":
      return "Open buffers";
    case "selected-paths":
      return "Selected paths";
    case "modified-files":
      return "Modified files";
    default:
      return "Workspace";
  }
}

function normalizeResult(item: SearchResultItem): NormalizedResult {
  const anyItem = item as any;
  const line = item.line ?? anyItem.lineNumber ?? 0;
  const column = item.column ?? anyItem.column ?? 0;
  const excerpt = item.previewMatch ?? anyItem.excerpt ?? "";
  return {
    ...item,
    line,
    column,
    previewMatch: item.previewMatch ?? excerpt,
    displayLabel: item.label ?? basename(item.path),
    displayLine: line,
    displayColumn: column,
    displayExcerpt: excerpt,
    displayKind: item.kind ?? "content",
  };
}

function resultSort(a: NormalizedResult, b: NormalizedResult): number {
  const pathCmp = normalizePath(a.path).localeCompare(normalizePath(b.path));
  if (pathCmp !== 0) return pathCmp;
  if (a.displayLine !== b.displayLine) return a.displayLine - b.displayLine;
  return a.displayColumn - b.displayColumn;
}

export default function SearchPanel(props: SearchPanelProps): JSX.Element {
  const rawTitle = props.title ?? "Search surface";
  const title = rawTitle.toLowerCase() === "search" ? "Workspace query" : rawTitle;
  const subtitle =
    props.subtitle ??
    "Governed search across workspace content, with explicit scope, trust posture, diagnostics pressure, and review lineage context.";

  const query = props.query ?? "";
  const [localQuery, setLocalQuery] = useState(query);
  const scope = props.scope ?? "workspace";
  const health = props.health ?? "healthy";
  const indexState = props.indexState ?? "unknown";
  const loading = props.loading ?? false;
  const canSearch = props.canSearch ?? true;

  const regex = props.regex ?? props.filters?.regex ?? false;
  const matchCase = props.matchCase ?? props.filters?.caseSensitive ?? false;
  const wholeWord = props.wholeWord ?? props.filters?.wholeWord ?? false;
  const includeIgnored = props.filters?.includeIgnored ?? false;
  const includeHidden = props.filters?.includeHidden ?? false;

  const normalizedResults = useMemo(() => {
    return (props.results ?? []).map(normalizeResult).sort(resultSort);
  }, [props.results]);

  const selectedResultId = props.selectedResultId ?? normalizedResults[0]?.id ?? null;
  const duplicateLabels = new Set(normalizedResults.map((result) => result.displayLabel)).size !== normalizedResults.length;

  const callRefresh = props.onRefresh ?? props.onRefreshRequested;
  const totalResultCount = props.totalResultCount ?? props.resultCount ?? normalizedResults.length;

  function toggleCase(): void {
    props.onMatchCaseChange?.(!matchCase);
    props.onToggleCaseSensitive?.(!matchCase);
  }

  function toggleWholeWord(): void {
    props.onWholeWordChange?.(!wholeWord);
    props.onToggleWholeWord?.(!wholeWord);
  }

  function toggleRegex(): void {
    props.onRegexChange?.(!regex);
    props.onToggleRegex?.(!regex);
  }

  function toggleIgnored(): void {
    props.onToggleIncludeIgnored?.(!includeIgnored);
  }

  function toggleHidden(): void {
    props.onToggleIncludeHidden?.(!includeHidden);
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Query</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {health !== "healthy" ? (
              <span className="rounded-full border border-amber-700/30 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-300">
                {health}
              </span>
            ) : null}
            <span className="rounded-full border border-emerald-700/30 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-300">
              {indexState}
            </span>
            <button
              type="button"
              disabled={!callRefresh}
              onClick={callRefresh}
              className={cx("rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-sm text-zinc-200", !callRefresh && "opacity-40")}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_auto]">
          <input
            value={localQuery}
            onChange={(event) => {
              setLocalQuery(event.target.value);
              props.onQueryChange?.(event.target.value);
            }}
            placeholder="Workspace content query"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none"
          />

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={toggleCase} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200">
              Case
            </button>
            <button type="button" onClick={toggleWholeWord} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200">
              Whole word
            </button>
            <button type="button" onClick={toggleRegex} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200">
              Regex
            </button>
            <button type="button" onClick={toggleIgnored} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200">
              Ignored
            </button>
            <button type="button" onClick={toggleHidden} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200">
              Hidden
            </button>
            <button
              type="button"
              onClick={() => props.onScopeChange?.(scope)}
              className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200"
            >
              Scope: {scopeLabel(scope)}
            </button>
            <button
              type="button"
              disabled={!canSearch || !props.onSearch}
              onClick={props.onSearch}
              aria-label="Search"
              className="rounded-full border border-indigo-700/40 px-3 py-1.5 text-xs text-indigo-200"
            >
              Run
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid gap-3 md:grid-cols-4">
          {["indexed", "searched", "content", "path"].map((label) => (
            <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
            </div>
          ))}
        </div>

        {loading ? <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">Evaluating governed query surface…</div> : null}

        <div className="mt-5 space-y-3">
          {normalizedResults.length === 0 ? (
            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-400">
              No results for {localQuery || "the current query"}.
            </div>
          ) : (
            normalizedResults.map((result) => {
              const selected = result.id === selectedResultId;
              return (
                <article key={result.id} className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => props.onSelectResult?.(result.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="text-sm font-semibold text-zinc-100">{result.displayLabel}</div>
                      {duplicateLabels && result.description ? (
                        <div className="mt-1 text-xs text-zinc-500">{result.description}</div>
                      ) : selected ? (
                        <div className="mt-1 break-all text-xs text-zinc-500">{result.path}</div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                        <span>{result.displayLine}</span>
                        <span>{result.displayColumn}</span>
                      </div>
                    </button>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => props.onOpenResult?.(result)}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onRevealResult?.(result)}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
                      >
                        Reveal
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 font-mono text-xs text-zinc-300">
                    {result.displayExcerpt}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="mt-5 text-xs uppercase tracking-[0.2em] text-zinc-500">{totalResultCount} total</div>
      </main>
    </section>
  );
}
