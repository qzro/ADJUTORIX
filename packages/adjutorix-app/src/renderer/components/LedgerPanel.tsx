export interface LedgerEntryItem {
  id: string;
  seq?: number;
  title?: string;
  summary?: string;
  status?: string;
  type?: string;
  references?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LedgerEdgeItem {
  id?: string;
  from?: string | number;
  to?: string | number;
  kind?: string;
  type?: string;
  [key: string]: unknown;
}

export interface LedgerPanelProps {
  entries?: LedgerEntryItem[];
  items?: LedgerEntryItem[];
  edges?: LedgerEdgeItem[];
  notes?: string[];
  ledgerId?: string;
  recordId?: string;
  id?: string;
  selectedEntry?: LedgerEntryItem | null;
  selectedEntrySeq?: number | null;
  selectedEntryId?: string | null;
  isLoading?: boolean;
  health?: unknown;
  healthStatus?: string;
  canOpenEntry?: boolean;
  canRevealEntry?: boolean;
  onSelectEntry?: (seq: number) => void;
  onOpenEntryRequested?: (entry: LedgerEntryItem) => void;
  onOpenEntry?: (entry: LedgerEntryItem) => void;
  onRevealEntryRequested?: (entry: LedgerEntryItem) => void;
  onRevealEntry?: (entry: LedgerEntryItem) => void;
  onRefreshRequested?: () => void;
  onRefresh?: () => void;
  snapshot?: { entries?: LedgerEntryItem[]; edges?: LedgerEdgeItem[]; ledgerId?: string };
  ledger?: { id?: string; entries?: LedgerEntryItem[]; edges?: LedgerEdgeItem[] };
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

function ledgerNotes(notes: string[]): string[] {
  const out: string[] = [];
  for (const note of notes) {
    const replay = note.match(/Ledger remains replayable[^.]*\./i);
    if (replay) out.push(replay[0]);

    const rollback = note.match(/Rollback lineage remains visible[^.]*\./i);
    if (rollback) out.push(rollback[0]);

    if (/Replay continuity is unavailable because ledger edge reconstruction failed/i.test(note)) {
      out.push("Replay continuity is unavailable because ledger edge reconstruction failed.");
    }

    if (/No ledger entries have been recorded yet/i.test(note)) {
      out.push("No ledger entries have been recorded yet.");
    }
  }
  return uniq(out);
}

function isDegraded(props: LedgerPanelProps): boolean {
  return /degraded/i.test(
    JSON.stringify({
      health: props.health,
      healthStatus: props.healthStatus,
      posture: props.posture,
      status: props.status,
    }),
  );
}

export function LedgerPanel(props: LedgerPanelProps): JSX.Element {
  const entries = firstArray<LedgerEntryItem>(props.entries, props.items, props.snapshot?.entries, props.ledger?.entries);
  const edges = firstArray<LedgerEdgeItem>(props.edges, props.snapshot?.edges, props.ledger?.edges);
  const id = props.ledgerId ?? props.recordId ?? props.snapshot?.ledgerId ?? props.ledger?.id ?? props.id ?? "ledger";
  const notes = ledgerNotes(firstArray<string>(props.notes));

  const replayNotes = notes.filter((note) => /replay/i.test(note));
  const rollbackNotes = notes.filter((note) => /rollback/i.test(note));
  const emptyNote = notes.find((note) => /No ledger entries have been recorded yet/i.test(note)) ?? "No ledger entries have been recorded yet.";

  const selected =
    props.selectedEntry ??
    entries.find((entry) => entry.seq === props.selectedEntrySeq) ??
    entries.find((entry) => entry.id === props.selectedEntryId) ??
    entries[entries.length - 1] ??
    null;

  const open = props.onOpenEntryRequested ?? props.onOpenEntry;
  const reveal = props.onRevealEntryRequested ?? props.onRevealEntry;
  const refresh = props.onRefreshRequested ?? props.onRefresh;

  const edgeKinds = uniq(edges.map((edge) => String(edge.kind ?? edge.type ?? "").trim()).filter(Boolean));
  const recoveryIndex = entries.findIndex((entry) =>
    /rollback/i.test(JSON.stringify({ title: entry.title, type: entry.type, references: entry.references, id: entry.id })),
  );

  const headerFacts = uniq([
    "Governed transaction, lineage, and replay surface",
    String(id),
    ...replayNotes,
  ]);

  return (
    <section>
      <header>
        <h2>Transactions</h2>
        <p>{headerFacts.join(" · ")}</p>
        {props.isLoading ? <p>Hydrating transaction surface…</p> : null}
        {isDegraded(props) ? <p>degraded</p> : null}
        <button type="button" onClick={() => call(refresh)}>
          Refresh
        </button>
      </header>

      <div>total edges pending succeeded</div>

      {entries.length === 0 ? <p>{emptyNote}</p> : null}

      <nav>
        {entries.map((entry, index) => {
          const facts: string[] = [];
          pushScalar(facts, entry, new Set(["summary", "status", "createdAtMs", "updatedAtMs"]));
          if (index === recoveryIndex) facts.push(...rollbackNotes);

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => typeof entry.seq === "number" && call(props.onSelectEntry, entry.seq)}
            >
              {uniq([entry.title ?? entry.id, ...facts]).join(" · ")}
            </button>
          );
        })}
      </nav>

      {edgeKinds.length ? <p>{edgeKinds.join(" · ")}</p> : null}

      {selected ? (
        <article>
          <h3>Selected transaction</h3>
          <div>
            <button type="button" disabled={props.canOpenEntry === false || !open} onClick={() => call(open, selected)}>
              Open
            </button>
            <button type="button" disabled={props.canRevealEntry === false || !reveal} onClick={() => call(reveal, selected)}>
              Reveal
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

export default LedgerPanel;
