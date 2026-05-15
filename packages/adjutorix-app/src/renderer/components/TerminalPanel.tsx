// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";

export type TerminalExecutionState =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "degraded";

export type TerminalTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted";
export type TerminalOutputKind = "stdin" | "stdout" | "stderr" | "system" | "command";
export type TerminalSeverity = "none" | "info" | "warn" | "error" | "critical";

export type TerminalCommandSummary = {
  commandId?: string;
  commandText?: string;
  cwd?: string | null;
  shell?: string | null;
  startedAtMs?: number | null;
  endedAtMs?: number | null;
  exitCode?: number | null;
  executionState?: TerminalExecutionState;
  trustLevel?: TerminalTrustLevel;
  requestHash?: string | null;
  sourceLabel?: string | null;
  guarded?: boolean;
  requiresConfirmation?: boolean;

  id?: string;
  command?: string;
  launchedAtMs?: number | null;
};

export type TerminalOutputEntry = {
  seq?: number;
  kind?: TerminalOutputKind;
  stream?: TerminalOutputKind;
  text: string;
  atMs?: number;
  createdAtMs?: number;
  severity?: TerminalSeverity;
  commandId?: string | null;
  id?: string;
};

export type TerminalPanelProps = {
  title?: string;
  subtitle?: string;
  loading?: boolean;

  health?: "healthy" | "degraded" | "unhealthy" | "unknown";
  trustLevel?: TerminalTrustLevel;
  shellStatus?: "ready" | "failed" | "degraded" | "unknown" | string;
  runState?: TerminalExecutionState;
  executionState?: TerminalExecutionState;

  shellLabel?: string | null;
  shellPath?: string | null;
  cwd?: string | null;

  commandInput?: string;
  activeCommand?: TerminalCommandSummary | null;
  currentCommand?: TerminalCommandSummary | null;
  history?: TerminalOutputEntry[];
  outputEntries?: TerminalOutputEntry[];
  commandHistory?: TerminalCommandSummary[];

  environmentFingerprint?: {
    platform?: string | null;
    nodeVersion?: string | null;
    npmVersion?: string | null;
    workspaceHash?: string | null;
  } | null;

  metrics?: {
    totalLines?: number;
    stdoutLines?: number;
    stderrLines?: number;
    systemLines?: number;
    stdinLines?: number;
  };

  canRun?: boolean;
  canCancel?: boolean;
  canClear?: boolean;
  canRevealLog?: boolean;

  filterQuery?: string;
  showStdout?: boolean;
  showStderr?: boolean;
  showSystem?: boolean;
  showCommands?: boolean;
  autoScroll?: boolean;

  onCommandInputChange?: (value: string) => void;
  onRunRequested?: () => void;
  onCancelRequested?: () => void;
  onInterruptRequested?: () => void;
  onClearRequested?: () => void;
  onRevealLogRequested?: () => void;
  onRefreshRequested?: () => void;
  onCopyTranscriptRequested?: () => void;
  onRetryRequested?: () => void;

  onToggleAutoScroll?: (value: boolean) => void;
  onToggleStdout?: (value: boolean) => void;
  onToggleStderr?: (value: boolean) => void;
  onToggleSystem?: (value: boolean) => void;
  onToggleCommands?: (value: boolean) => void;
  onFilterQueryChange?: (value: string) => void;
  onSelectHistoryCommand?: (command: TerminalCommandSummary) => void;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function badgeTone(value: string): string {
  if (/trusted|ready|succeeded/i.test(value)) return "border-emerald-700/30 bg-emerald-500/10 text-emerald-300";
  if (/restricted|degraded|guarded|running/i.test(value)) return "border-amber-700/30 bg-amber-500/10 text-amber-300";
  if (/failed|untrusted|interrupted|error/i.test(value)) return "border-rose-700/30 bg-rose-500/10 text-rose-300";
  return "border-zinc-700/30 bg-zinc-500/10 text-zinc-300";
}

function normalizeCommand(command: TerminalCommandSummary | null | undefined): TerminalCommandSummary | null {
  if (!command) return null;
  return {
    ...command,
    commandId: command.commandId ?? command.id,
    commandText: command.commandText ?? command.command,
    startedAtMs: command.startedAtMs ?? command.launchedAtMs,
  };
}

function normalizeLines(props: TerminalPanelProps): TerminalOutputEntry[] {
  const source = props.history ?? props.outputEntries ?? [];
  return source
    .map((entry, index) => ({
      ...entry,
      seq: entry.seq ?? index + 1,
      kind: entry.kind ?? entry.stream ?? "stdout",
      atMs: entry.atMs ?? entry.createdAtMs ?? 0,
      id: entry.id ?? `${entry.kind ?? entry.stream ?? "line"}-${entry.seq ?? index + 1}`,
    }))
    .sort((a, b) => {
      const seqDelta = (a.seq ?? 0) - (b.seq ?? 0);
      if (seqDelta !== 0) return seqDelta;
      return (a.atMs ?? 0) - (b.atMs ?? 0);
    });
}

function buildMetrics(lines: TerminalOutputEntry[], explicit?: TerminalPanelProps["metrics"]) {
  if (explicit) {
    return {
      totalLines: explicit.totalLines ?? lines.length,
      stdoutLines: explicit.stdoutLines ?? lines.filter((line) => line.kind === "stdout").length,
      stderrLines: explicit.stderrLines ?? lines.filter((line) => line.kind === "stderr").length,
      systemLines: explicit.systemLines ?? lines.filter((line) => line.kind === "system").length,
      stdinLines: explicit.stdinLines ?? lines.filter((line) => line.kind === "stdin" || line.kind === "command").length,
    };
  }

  return {
    totalLines: lines.length,
    stdoutLines: lines.filter((line) => line.kind === "stdout").length,
    stderrLines: lines.filter((line) => line.kind === "stderr").length,
    systemLines: lines.filter((line) => line.kind === "system").length,
    stdinLines: lines.filter((line) => line.kind === "stdin" || line.kind === "command").length,
  };
}

function SummaryFact(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{props.label}</div>
      <div className="mt-1 break-words text-sm font-medium text-zinc-100">{props.value ?? "Unknown"}</div>
    </div>
  );
}

function Badge(props: { children: React.ReactNode; value: string }) {
  return (
    <span className={cx("rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em]", badgeTone(props.value))}>
      {props.children}
    </span>
  );
}

function ActionButton(props: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const disabled = props.disabled || !props.onClick;

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={disabled}
      className={cx(
        "rounded-2xl border px-4 py-2 text-sm font-medium transition",
        disabled
          ? "cursor-not-allowed border-zinc-800 bg-zinc-950/60 text-zinc-500"
          : "border-zinc-700 bg-zinc-950/70 text-zinc-100 hover:bg-zinc-900",
      )}
    >
      {props.label}
    </button>
  );
}

export default function TerminalPanel(props: TerminalPanelProps): JSX.Element {
  const title = props.title ?? "Terminal";
  const subtitle = props.subtitle ?? "Governed shell execution and output surface";
  const trustLevel = props.trustLevel ?? "unknown";
  const shellStatus =
    props.shellStatus ??
    (props.health === "degraded" ? "degraded" : props.health === "unhealthy" ? "failed" : "ready");
  const runState =
    props.runState ??
    props.executionState ??
    props.currentCommand?.executionState ??
    props.activeCommand?.executionState ??
    "idle";

  const shellLabel = props.shellLabel ?? props.shellPath ?? "Unknown";
  const activeCommand = normalizeCommand(props.activeCommand ?? props.currentCommand ?? null);
  const lines = useMemo(() => normalizeLines(props), [props.history, props.outputEntries]);
  const metrics = useMemo(() => buildMetrics(lines, props.metrics), [lines, props.metrics]);

  const [commandInput, setCommandInput] = useState(props.commandInput ?? "");

  useEffect(() => {
    setCommandInput(props.commandInput ?? "");
  }, [props.commandInput]);

  const visibleLines = useMemo(() => {
    return lines.filter((line) => {
      if (line.kind === "stdout" && props.showStdout === false) return false;
      if (line.kind === "stderr" && props.showStderr === false) return false;
      if (line.kind === "system" && props.showSystem === false) return false;
      if ((line.kind === "stdin" || line.kind === "command") && props.showCommands === false) return false;
      if (!props.filterQuery?.trim()) return true;
      return line.text.toLowerCase().includes(props.filterQuery.trim().toLowerCase());
    });
  }, [lines, props.filterQuery, props.showCommands, props.showStderr, props.showStdout, props.showSystem]);

  const canRun = props.canRun ?? Boolean(props.onRunRequested);
  const canCancel = props.canCancel ?? Boolean(props.onCancelRequested ?? props.onInterruptRequested);
  const canClear = props.canClear ?? Boolean(props.onClearRequested);
  const canRevealLog = props.canRevealLog ?? Boolean(props.onRevealLogRequested);
  const hasActiveCommand = Boolean(activeCommand?.commandText || commandInput);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Shell surface</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge value={trustLevel}>{trustLevel}</Badge>
            <Badge value={shellStatus}>{shellStatus}</Badge>
            <Badge value={runState}>{runState}</Badge>
            {activeCommand?.guarded ? <Badge value="guarded">guarded</Badge> : null}
            {activeCommand?.requiresConfirmation ? (
              <Badge value="requires confirmation">requires confirmation</Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_34rem]">
          <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/60 p-4">
            <label className="text-[10px] uppercase tracking-[0.2em] text-zinc-500" htmlFor="terminal-command-input">
              Command intent
            </label>
            <input
              id="terminal-command-input"
              value={commandInput}
              onChange={(event) => {
                setCommandInput(event.target.value);
                props.onCommandInputChange?.(event.target.value);
              }}
              placeholder="Enter command intent"
              className="mt-3 w-full rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton label="Run" onClick={props.onRunRequested} disabled={!canRun} />
              <ActionButton
                label="Cancel"
                onClick={props.onCancelRequested ?? props.onInterruptRequested}
                disabled={!canCancel}
              />
              <ActionButton label="Clear" onClick={props.onClearRequested} disabled={!canClear} />
              <ActionButton label="Reveal log" onClick={props.onRevealLogRequested} disabled={!canRevealLog} />
              <ActionButton label="Refresh" onClick={props.onRefreshRequested ?? props.onRetryRequested} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryFact label="Shell" value={shellLabel} />
            <SummaryFact label="CWD" value={props.cwd ?? activeCommand?.cwd ?? "Unknown"} />
            <SummaryFact
              label="Exit"
              value={typeof activeCommand?.exitCode === "number" ? String(activeCommand.exitCode) : "N/A"}
            />
            <SummaryFact
              label="Started"
              value={
                activeCommand?.startedAtMs
                  ? new Date(activeCommand.startedAtMs).toISOString()
                  : "Unknown"
              }
            />
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-5">
        {props.loading ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-300">
            Hydrating shell transcript…
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/40 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Execution context</div>
              <h3 className="mt-1 text-base font-semibold text-zinc-50">Active command</h3>

              <pre className="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-zinc-800 bg-black/30 p-4 font-mono text-sm leading-7 text-zinc-100">
                {activeCommand?.commandText ?? commandInput ?? "No command selected"}
              </pre>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <SummaryFact label="Command ID" value={activeCommand?.commandId ?? "None"} />
                <SummaryFact label="Request hash" value={activeCommand?.requestHash ?? "None"} />
                <SummaryFact label="Source" value={activeCommand?.sourceLabel ?? "User command intent"} />
              </div>
            </section>

            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/40 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Environment fingerprint</div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <SummaryFact label="Platform" value={props.environmentFingerprint?.platform ?? "Unknown"} />
                <SummaryFact label="Node" value={props.environmentFingerprint?.nodeVersion ?? "Unknown"} />
                <SummaryFact label="npm" value={props.environmentFingerprint?.npmVersion ?? "Unknown"} />
                <SummaryFact label="Workspace hash" value={props.environmentFingerprint?.workspaceHash ?? "Unknown"} />
              </div>
            </section>

            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/40 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Stream metrics</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryFact label="total" value={metrics.totalLines} />
                <SummaryFact label="stdout" value={metrics.stdoutLines} />
                <SummaryFact label="stderr" value={metrics.stderrLines} />
                <SummaryFact label="system" value={metrics.systemLines} />
                <SummaryFact label="stdin" value={metrics.stdinLines} />
              </div>
            </section>

            <section className="rounded-[2rem] border border-zinc-800 bg-zinc-950/40 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Transcript</div>
              <h3 className="mt-1 text-base font-semibold text-zinc-50">Observed output</h3>

              <div className="mt-4 space-y-3">
                {visibleLines.length > 0 ? (
                  visibleLines.map((line) => (
                    <pre
                      key={line.id ?? `${line.kind}-${line.seq}`}
                      className={cx(
                        "whitespace-pre-wrap break-words rounded-2xl border bg-black/30 p-4 font-mono text-sm leading-7",
                        line.kind === "stderr"
                          ? "border-rose-800/40 text-rose-200"
                          : line.kind === "system"
                            ? "border-amber-800/40 text-amber-200"
                            : line.kind === "stdin" || line.kind === "command"
                              ? "border-indigo-800/40 text-indigo-200"
                              : "border-zinc-800 text-zinc-100",
                      )}
                    >
                      {line.text}
                    </pre>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/30 p-5 text-sm text-zinc-500">
                    No command history is currently bound to this surface.
                  </div>
                )}
              </div>
            </section>

            {!hasActiveCommand && visibleLines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/30 p-5 text-sm text-zinc-500">
                No active command is currently bound to this surface.
              </div>
            ) : null}
          </div>
        )}
      </main>
    </section>
  );
}
