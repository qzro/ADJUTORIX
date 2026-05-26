import { useMemo, useState } from "react";

type UnknownAsyncBridge = (...args: unknown[]) => unknown | Promise<unknown>;

type LedgerBridge = {
  entry?: unknown;
  heads?: unknown;
  stats?: unknown;
  timeline?: unknown;
};

type AdjutorixWindow = Window & {
  adjutorix?: {
    ledger?: LedgerBridge;
  };
};

type LedgerCall = "timeline" | "heads" | "stats" | "entry";

function getAdjutorixWindow(): AdjutorixWindow {
  return window as unknown as AdjutorixWindow;
}

function isBridgeFunction(value: unknown): value is UnknownAsyncBridge {
  return typeof value === "function";
}

function stringifyEvidence(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function OperatorEvidenceLedgerPanel() {
  const [selectedCall, setSelectedCall] = useState<LedgerCall>("timeline");
  const [ledgerResult, setLedgerResult] = useState("No ledger query has been executed in this surface yet.");
  const [ledgerState, setLedgerState] = useState("idle");

  const capabilityMap = useMemo(() => {
    const ledger = getAdjutorixWindow().adjutorix?.ledger;

    return {
      timeline: isBridgeFunction(ledger?.timeline),
      heads: isBridgeFunction(ledger?.heads),
      stats: isBridgeFunction(ledger?.stats),
      entry: isBridgeFunction(ledger?.entry),
    };
  }, []);

  const readyCount = Object.values(capabilityMap).filter(Boolean).length;

  async function runLedgerCall(call: LedgerCall) {
    const ledger = getAdjutorixWindow().adjutorix?.ledger;
    const bridge = ledger?.[call];

    setSelectedCall(call);

    if (!isBridgeFunction(bridge)) {
      setLedgerState("bridge-unavailable");
      setLedgerResult(`adjutorix.ledger.${call} bridge unavailable.`);
      return;
    }

    setLedgerState("querying");

    try {
      const result = await bridge();
      setLedgerState("resolved");
      setLedgerResult(stringifyEvidence(result));
    } catch (error) {
      setLedgerState("error");
      setLedgerResult(error instanceof Error ? error.message : stringifyEvidence(error));
    }
  }

  return (
    <section
      aria-label="Operator evidence ledger surface"
      data-testid="operator-evidence-ledger-surface"
      className="operator-evidence-ledger-surface"
    >
      <header>
        <p data-testid="operator-evidence-ledger-kicker">Evidence ledger</p>
        <h2>Operator Evidence Ledger</h2>
        <p>
          Inspect runtime evidence without leaving the governed ADJUTORIX operator surface.
          This binds ledger timeline, heads, stats, and entry access into one user-visible path.
        </p>
      </header>

      <div data-testid="operator-evidence-ledger-capability-status">
        <strong>Ledger bridge readiness:</strong> {readyCount}/4 channels available
      </div>

      <div data-testid="operator-ledger-channel-status">
        <span>ledger.timeline: {capabilityMap.timeline ? "ready" : "unavailable"}</span>
        <span>ledger.heads: {capabilityMap.heads ? "ready" : "unavailable"}</span>
        <span>ledger.stats: {capabilityMap.stats ? "ready" : "unavailable"}</span>
        <span>ledger.entry: {capabilityMap.entry ? "ready" : "unavailable"}</span>
      </div>

      <div data-testid="operator-evidence-ledger-actions">
        <button type="button" onClick={() => void runLedgerCall("timeline")}>
          Load timeline
        </button>
        <button type="button" onClick={() => void runLedgerCall("heads")}>
          Load heads
        </button>
        <button type="button" onClick={() => void runLedgerCall("stats")}>
          Load stats
        </button>
        <button type="button" onClick={() => void runLedgerCall("entry")}>
          Load latest entry
        </button>
      </div>

      <article data-testid="operator-evidence-ledger-output">
        <p>
          Selected call: <strong>adjutorix.ledger.{selectedCall}</strong>
        </p>
        <p>
          State: <strong>{ledgerState}</strong>
        </p>
        <pre>{ledgerResult}</pre>
      </article>
    </section>
  );
}
