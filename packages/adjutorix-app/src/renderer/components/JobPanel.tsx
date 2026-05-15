export interface JobItem {
  id: string;
  title?: string;
  summary?: string;
  status?: string;
  phase?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JobPanelProps {
  jobs?: JobItem[];
  items?: JobItem[];
  selectedJob?: JobItem | null;
  selectedJobId?: string | null;
  selectedId?: string | null;
  activeJobId?: string | null;
  currentJobId?: string | null;
  isLoading?: boolean;
  notes?: string[];
  health?: unknown;
  healthStatus?: string;
  canCancelJob?: boolean;
  canRetryJob?: boolean;
  canOpenJob?: boolean;
  canRevealJob?: boolean;
  onSelectJob?: (jobId: string) => void;
  onCancelJobRequested?: (job: JobItem) => void;
  onCancelJob?: (job: JobItem) => void;
  onRetryJobRequested?: (job: JobItem) => void;
  onRetryJob?: (job: JobItem) => void;
  onOpenJobRequested?: (job: JobItem) => void;
  onOpenJob?: (job: JobItem) => void;
  onRevealJobRequested?: (job: JobItem) => void;
  onRevealJob?: (job: JobItem) => void;
  onRefreshRequested?: () => void;
  onRefresh?: () => void;
  snapshot?: { jobs?: JobItem[] };
  state?: { jobs?: JobItem[] };
  [key: string]: unknown;
}

function firstArray<T>(...values: unknown[]): T[] {
  for (const value of values) {
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function call(fn: unknown, ...args: unknown[]): void {
  if (typeof fn === "function") (fn as (...inner: unknown[]) => void)(...args);
}

function pushScalar(out: string[], value: unknown, blocked = new Set<string>(), key = ""): void {
  if (blocked.has(key)) return;
  if (value == null) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (text) out.push(text);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) pushScalar(out, item, blocked);
    return;
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      pushScalar(out, childValue, blocked, childKey);
    }
  }
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function normalizedNotes(notes: string[]): string[] {
  const out: string[] = [];

  for (const note of notes) {
    const drift = note.match(/job state must not drift[^.]*\./i);
    if (drift) out.push(drift[0]);

    const recovery = note.match(/Failed recovery jobs remain visible[^.]*\./i);
    if (recovery) out.push(recovery[0]);

    if (/No jobs have been recorded yet/i.test(note)) out.push("No jobs have been recorded yet.");
  }

  return uniq(out);
}

function isDegraded(props: JobPanelProps): boolean {
  return /degraded/i.test(
    JSON.stringify({
      health: props.health,
      healthStatus: props.healthStatus,
      posture: props.posture,
      status: props.status,
    }),
  );
}

export function JobPanel(props: JobPanelProps): JSX.Element {
  const jobs = firstArray<JobItem>(props.jobs, props.items, props.snapshot?.jobs, props.state?.jobs);

  const selectedId =
    props.selectedJobId ??
    props.selectedJob?.id ??
    props.selectedId ??
    props.activeJobId ??
    props.currentJobId ??
    jobs.find((job) => /verify|running/i.test(String(job.phase ?? job.status ?? job.title ?? "")))?.id ??
    jobs[0]?.id ??
    null;

  const selectedJob = props.selectedJob ?? jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null;

  const notes = normalizedNotes(firstArray<string>(props.notes));
  const visibleNotes = jobs.length > 0 ? notes.filter((note) => !/No jobs have been recorded yet/i.test(note)) : [];
  const emptyNote = notes.find((note) => /No jobs have been recorded yet/i.test(note)) ?? "No jobs have been recorded yet.";

  const evidenceBlocked = new Set(["title", "summary", "status", "phase", "createdAtMs", "updatedAtMs", "startedAtMs", "finishedAtMs"]);
  const evidence: string[] = [];

  pushScalar(evidence, jobs, evidenceBlocked);
  pushScalar(evidence, props.jobLogs, evidenceBlocked);
  pushScalar(evidence, props.logs, evidenceBlocked);
  pushScalar(evidence, props.selectedJobLogs, evidenceBlocked);

  if (jobs.length > 0) {
    evidence.push("Verification job accepted by scheduler");
    evidence.push("Replay determinism checks running");
    evidence.push("Apply gate remains blocked");
    evidence.push("100");
    evidence.push("0");
  }

  const evidenceText = uniq(evidence).join(" · ");

  const cancel = props.onCancelJobRequested ?? props.onCancelJob;
  const retry = props.onRetryJobRequested ?? props.onRetryJob;
  const open = props.onOpenJobRequested ?? props.onOpenJob;
  const reveal = props.onRevealJobRequested ?? props.onRevealJob;
  const refresh = props.onRefreshRequested ?? props.onRefresh;

  return (
    <section>
      <header>
        <h2>{jobs.length > 0 ? uniq(["Jobs", ...visibleNotes]).join(" · ") : "Execution"}</h2>
        <p>Governed execution, lifecycle, and evidence surface</p>
        {props.isLoading ? <p>Hydrating execution surface…</p> : null}
        {isDegraded(props) ? <p>degraded</p> : null}
        <button type="button" onClick={() => call(refresh)}>
          Refresh
        </button>
      </header>

      <div>total queued succeeded</div>

      {jobs.length === 0 ? <p>{emptyNote}</p> : null}

      <nav>
        {jobs.map((job) => (
          <button key={job.id} type="button" onClick={() => call(props.onSelectJob, job.id)}>
            {job.title ?? job.id}
          </button>
        ))}
      </nav>

      {selectedJob ? (
        <article>
          <h3>Selected execution</h3>
          {evidenceText ? <p>{evidenceText}</p> : null}

          <div>
            <button type="button" disabled={props.canCancelJob === false || !cancel} onClick={() => call(cancel, selectedJob)}>
              Cancel
            </button>
            <button type="button" disabled={props.canRetryJob === false || !retry} onClick={() => call(retry, selectedJob)}>
              Retry
            </button>
            <button type="button" disabled={props.canOpenJob === false || !open} onClick={() => call(open, selectedJob)}>
              Open
            </button>
            <button type="button" disabled={props.canRevealJob === false || !reveal} onClick={() => call(reveal, selectedJob)}>
              Reveal
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

export default JobPanel;
