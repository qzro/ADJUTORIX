/**
 * UI-side agent state manager.
 * Mirrors server job/log/diff state for rendering.
 */

export interface JobInfo {
  id: string;
  status: "idle" | "running" | "success" | "error";
  objective: string;
  startedAt: number;
  finishedAt?: number;
}

export interface DiffInfo {
  path: string;
  hunks: number;
  additions: number;
  deletions: number;
  patch: string;
}

export interface LogEntry {
  ts: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface SerializedState {
  jobs: JobInfo[];
  diffs: DiffInfo[];
  logs: LogEntry[];
  activeJob?: string;
}

/**
 * Central in-memory UI state.
 */
export class AgentState {
  private jobs: Map<string, JobInfo> = new Map();
  private diffs: Map<string, DiffInfo> = new Map();
  private logs: LogEntry[] = [];

  private activeJob?: string;

  /* -------------------------
   * Jobs
   * ------------------------- */

  addJob(job: JobInfo) {
    this.jobs.set(job.id, job);
  }

  updateJob(id: string, patch: Partial<JobInfo>) {
    const job = this.jobs.get(id);
    if (!job) return;

    Object.assign(job, patch);
  }

  setActiveJob(id?: string) {
    this.activeJob = id;
  }

  getActiveJob(): JobInfo | undefined {
    if (!this.activeJob) return;
    return this.jobs.get(this.activeJob);
  }

  listJobs(): JobInfo[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );
  }

  /* -------------------------
   * Diffs
   * ------------------------- */

  upsertDiff(diff: DiffInfo) {
    this.diffs.set(diff.path, diff);
  }

  removeDiff(path: string) {
    this.diffs.delete(path);
  }

  clearDiffs() {
    this.diffs.clear();
  }

  listDiffs(): DiffInfo[] {
    return Array.from(this.diffs.values());
  }

  /* -------------------------
   * Logs
   * ------------------------- */

  log(level: LogEntry["level"], message: string) {
    this.logs.push({
      ts: Date.now(),
      level,
      message,
    });

    // prevent memory bloat
    if (this.logs.length > 2000) {
      this.logs.shift();
    }
  }

  info(msg: string) {
    this.log("info", msg);
  }

  warn(msg: string) {
    this.log("warn", msg);
  }

  error(msg: string) {
    this.log("error", msg);
  }

  clearLogs() {
    this.logs = [];
  }

  listLogs(): LogEntry[] {
    return this.logs.slice();
  }

  /* -------------------------
   * Commands
   * ------------------------- */

  enqueueCommand(cmd: string) {
    this.info(`Command queued: ${cmd}`);
  }

  /* -------------------------
   * Serialization
   * ------------------------- */

  serialize(): SerializedState {
    return {
      jobs: this.listJobs(),
      diffs: this.listDiffs(),
      logs: this.listLogs(),
      activeJob: this.activeJob,
    };
  }

  load(state: SerializedState) {
    this.jobs.clear();
    this.diffs.clear();
    this.logs = [];

    for (const j of state.jobs) {
      this.jobs.set(j.id, j);
    }

    for (const d of state.diffs) {
      this.diffs.set(d.path, d);
    }

    this.logs = state.logs || [];
    this.activeJob = state.activeJob;
  }
}
