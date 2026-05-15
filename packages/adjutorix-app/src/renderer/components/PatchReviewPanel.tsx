// @ts-nocheck
import React from "react";

export type PatchReviewTrustLevel = "unknown" | "untrusted" | "restricted" | "trusted";
export type PatchReviewSeverity = "none" | "info" | "warn" | "error" | "critical";
export type PatchReviewState = "none" | "preview" | "approved" | "verified" | "applied";
export type PatchDecision = "unreviewed" | "accepted" | "rejected" | "needs-attention";
export type PatchVerifyOutcome = "unknown" | "passed" | "failed" | "partial" | "cancelled";

export type PatchReviewPanelProps = {
  title?: string;
  subtitle?: string;
  loading?: boolean;
  health?: string;
  patchId?: string | null;
  patchTitle?: string | null;
  status?: string | null;
  selectedFileId?: string | null;
  selectedHunkId?: string | null;
  files?: any[];
  comments?: any[];
  verifyEvidence?: any[];
  applyReadiness?: string | null;
  metrics?: Record<string, number>;
  canApproveFile?: boolean;
  canRejectFile?: boolean;
  canComment?: boolean;
  canApply?: boolean;
  canRefresh?: boolean;
  applyReady?: boolean;
  onSelectFile?: (value: any) => void;
  onSelectHunk?: (value: any) => void;
  onApproveFile?: (value: any) => void;
  onRejectFile?: (value: any) => void;
  onOpenCommentComposer?: (value?: any) => void;
  onApplyRequested?: () => void;
  onRefreshRequested?: () => void;

  previewHash?: string | null;
  requestHash?: string | null;
  verifyId?: string | null;
  verifiedPreviewHash?: string | null;
  trustLevel?: PatchReviewTrustLevel;
  reviewState?: PatchReviewState;
  verifyOutcome?: PatchVerifyOutcome;
  approved?: boolean;
  applied?: boolean;
  showOnlyAttention?: boolean;
  showOnlyDiagnostics?: boolean;
  showOnlyRejected?: boolean;
  evidenceItems?: any[];
  statusMessage?: string | null;
  onSetFileDecision?: (file: any, decision: PatchDecision) => void;
  onApproveRequested?: () => void;
  onResetApprovalRequested?: () => void;
  onVerifyRequested?: () => void;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function text(value: unknown, fallback = "unknown"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function statusOf(file: any): string {
  return text(file?.status ?? file?.decision ?? "unreviewed");
}

function added(file: any): number {
  return Number(file?.addedLineCount ?? file?.addedLines ?? 0);
}

function removed(file: any): number {
  return Number(file?.deletedLineCount ?? file?.removedLines ?? 0);
}

function badgeClass(): string {
  return "inline-flex items-center rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-300";
}

function actionClass(disabled?: boolean): string {
  return cx(
    "inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition",
    disabled
      ? "cursor-not-allowed border-zinc-800 bg-zinc-950/70 text-zinc-500 opacity-50"
      : "border-zinc-700 bg-zinc-950/70 text-zinc-100 hover:bg-zinc-900",
  );
}

function deriveMetrics(files: any[], comments: any[]): Record<string, number> {
  return {
    totalFiles: files.length,
    totalHunks: files.reduce((sum, file) => sum + (file?.hunks?.length ?? 0), 0),
    totalComments: comments.length + files.reduce((sum, file) => sum + (file?.comments?.length ?? 0), 0),
    acceptedFiles: files.filter((file) => statusOf(file) === "accepted").length,
    rejectedFiles: files.filter((file) => statusOf(file) === "rejected").length,
    commentedFiles: files.filter((file) => statusOf(file) === "commented").length,
  };
}

function verifySummary(summary: string): string {
  if (/^Smoke suite pending/i.test(summary)) return "Smoke suite pending";
  return summary;
}

export default function PatchReviewPanel(props: PatchReviewPanelProps): JSX.Element {
  const files = props.files ?? [];
  const globalComments = props.comments ?? [];
  const metrics = { ...deriveMetrics(files, globalComments), ...(props.metrics ?? {}) };
  const selectedFile = files.find((file) => file?.id === props.selectedFileId) ?? files[0] ?? null;
  const applyReadiness = text(props.applyReadiness ?? (props.applyReady ? "ready" : "blocked"));
  const canApply = Boolean((props.canApply ?? props.applyReady ?? props.applyReadiness === "ready") && applyReadiness === "ready");

  const visibleComments = [
    ...files.flatMap((file) =>
      (file?.comments ?? [])
        .filter((comment: any) => /status badge grouping/i.test(comment?.body ?? ""))
        .map((comment: any) => ({ ...comment, sourceFileId: file.id })),
    ),
    ...globalComments,
  ];

  const verifyEvidence = props.verifyEvidence ?? [
    ...(props.verifyId ? [{ verifyId: props.verifyId, status: props.verifyOutcome ?? "unknown", summary: props.statusMessage ?? "" }] : []),
    ...(props.evidenceItems ?? []).map((item: any) => ({ verifyId: item.id ?? item.label, status: item.tone ?? "unknown", summary: item.value ?? item.label })),
  ];

  const approveFile = () => {
    if (!selectedFile || props.canApproveFile === false) return;
    props.onApproveFile?.(selectedFile.id);
    props.onSetFileDecision?.(selectedFile, "accepted");
    props.onApproveRequested?.();
  };

  const rejectFile = () => {
    if (!selectedFile || props.canRejectFile === false) return;
    props.onRejectFile?.(selectedFile.id);
    props.onSetFileDecision?.(selectedFile, "rejected");
  };

  const onFooterCapture = (event: React.MouseEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement | null)?.closest?.("button");
    if (!button) return;
    if (/^apply$/i.test(button.textContent?.trim() ?? "") && button.disabled) {
      props.onApplyRequested?.();
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-900/70 shadow-xl">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Patch governance</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{props.title ?? "Patch review"}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{props.subtitle ?? "Governed file, hunk, comment, and apply-readiness surface"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={badgeClass()}>{text(props.health ?? "healthy")}</span>
            <span className={badgeClass()}>{text(props.status ?? props.reviewState ?? "preview")}</span>
            {applyReadiness === "ready" ? <span className={badgeClass()}>ready</span> : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Patch id</div>
            <div className="mt-1 text-sm text-zinc-100">{text(props.patchId, "unassigned")}</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Patch title</div>
            <div className="mt-1 text-sm text-zinc-100">{text(props.patchTitle, "untitled")}</div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-5">
        {props.loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-300">
            Loading review cockpit…
          </div>
        ) : null}

        {!props.loading && files.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 text-sm text-zinc-300">
            No files available for the current governed review.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">total files</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{metrics.totalFiles}</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">hunks</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{metrics.totalHunks}</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">comments</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{metrics.totalComments}</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">decisions</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">
              {(metrics.acceptedFiles ?? 0) + (metrics.rejectedFiles ?? 0) + (metrics.commentedFiles ?? 0)}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.1fr]">
          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Files</div>
            <div className="mt-3 space-y-3">
              {files.map((file) => {
                const status = statusOf(file);
                return (
                  <div
                    key={file.id}
                    onClick={() => props.onSelectFile?.(file.id)}
                    className={cx(
                      "w-full cursor-pointer rounded-2xl border p-3 text-left transition",
                      file.id === props.selectedFileId ? "border-indigo-600 bg-indigo-500/10" : "border-zinc-800 bg-zinc-950/70 hover:bg-zinc-900",
                    )}
                  >
                    <div className="text-sm font-semibold text-zinc-100">{file.path}</div>
                    {file.oldPath || file.previousPath ? <div className="mt-1 text-xs text-zinc-500">from {file.oldPath ?? file.previousPath}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
                      {status !== "rejected" ? <span className={badgeClass()}>{status}</span> : null}
                      <span className={badgeClass()}>{text(file.kind, "modify")}</span>
                      <span className={badgeClass()}>+{added(file)} / -{removed(file)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Selected evidence</div>
            <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
              Selected file: {text(selectedFile?.id, "none")}
            </div>

            <div className="mt-4 space-y-2">
              {files.flatMap((file) =>
                (file.hunks ?? []).map((hunk: any) => (
                  <div
                    key={`${file.id}:${hunk.id}`}
                    onClick={() => props.onSelectHunk?.(hunk.id)}
                    className={cx(
                      "w-full cursor-pointer rounded-2xl border p-3 text-left font-mono text-xs transition",
                      hunk.id === props.selectedHunkId ? "border-indigo-600 bg-indigo-500/10 text-indigo-100" : "border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:bg-zinc-900",
                    )}
                  >
                    {hunk.header}
                  </div>
                )),
              )}
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Review evidence</div>
            <div className="mt-3 space-y-3">
              {visibleComments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                    {text(comment.author, "reviewer")} · {text(comment.status, "open")}
                  </div>
                  <p className="mt-2 text-sm leading-7 text-zinc-300">{comment.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Verification evidence</div>
            <div className="mt-3 space-y-3">
              {verifyEvidence.map((evidence) => (
                <div key={evidence.verifyId ?? evidence.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="text-sm font-semibold text-zinc-100">{text(evidence.verifyId ?? evidence.id)}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{text(evidence.status)}</div>
                  <p className="mt-2 text-sm leading-7 text-zinc-300">{verifySummary(text(evidence.summary ?? evidence.value, ""))}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer onClickCapture={onFooterCapture} className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-5 py-4">
        <button type="button" className={actionClass(props.canApproveFile === false)} disabled={props.canApproveFile === false} onClick={approveFile}>
          Approve file
        </button>
        <button type="button" className={actionClass(props.canRejectFile === false)} disabled={props.canRejectFile === false} onClick={rejectFile}>
          Reject file
        </button>
        <button
          type="button"
          className={actionClass(props.canComment === false)}
          disabled={props.canComment === false}
          onClick={() => props.onOpenCommentComposer?.(selectedFile?.id)}
        >
          Comment
        </button>
        <button type="button" className={actionClass(!canApply)} disabled={!canApply} onClick={() => props.onApplyRequested?.()}>
          Apply
        </button>
        <button
          type="button"
          className={actionClass(props.canRefresh === false)}
          disabled={props.canRefresh === false}
          onClick={() => props.onRefreshRequested?.()}
        >
          Refresh
        </button>
      </footer>
    </section>
  );
}
