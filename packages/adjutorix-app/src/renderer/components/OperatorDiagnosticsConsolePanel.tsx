import { useMemo, useState } from "react";

type DiagnosticRunState = {
  method: string;
  status: "idle" | "running" | "passed" | "failed";
  detail: string;
};

type AdjutorixWindow = Window & {
  adjutorix?: {
    diagnostics?: Record<string, unknown>;
    operatorKernel?: {
      lastHash?: unknown;
    };
  };
};

const diagnosticActions = [
  {
    method: "runtimeSnapshot",
    label: "Runtime snapshot",
    purpose: "Capture the current app/runtime posture before action continues."
  },
  {
    method: "startupReport",
    label: "Startup report",
    purpose: "Expose boot evidence instead of leaving startup health implicit."
  },
  {
    method: "observabilityBundle",
    label: "Observability bundle",
    purpose: "Collect structured observability evidence for operator review."
  },
  {
    method: "logTail",
    label: "Log tail",
    purpose: "Surface recent runtime logs without leaving the governed app path."
  },
  {
    method: "crashContext",
    label: "Crash context",
    purpose: "Promote failure context to first-class operator evidence."
  },
  {
    method: "exportBundle",
    label: "Export bundle",
    purpose: "Prepare a portable diagnostics artifact for review or escalation."
  }
] as const;

function getAdjutorixWindow(): AdjutorixWindow {
  return window as unknown as AdjutorixWindow;
}

function summarizeResult(result: unknown): string {
  if (result === undefined) return "bridge returned undefined";
  if (result === null) return "bridge returned null";
  if (typeof result === "string") return result.slice(0, 240);
  try {
    return JSON.stringify(result).slice(0, 420);
  } catch {
    return String(result).slice(0, 240);
  }
}

export function OperatorDiagnosticsConsolePanel() {
  const [lastRun, setLastRun] = useState<DiagnosticRunState>({
    method: "none",
    status: "idle",
    detail: "No diagnostic command has been executed from this surface yet."
  });

  const bridgePosture = useMemo(() => {
    const adjutorix = getAdjutorixWindow().adjutorix;
    const diagnostics = adjutorix?.diagnostics ?? {};
    const available = diagnosticActions.filter((action) => typeof diagnostics[action.method] === "function");
    const missing = diagnosticActions.filter((action) => typeof diagnostics[action.method] !== "function");

    return {
      availableCount: available.length,
      missingCount: missing.length,
      hasOperatorKernelHash: typeof adjutorix?.operatorKernel?.lastHash === "function"
    };
  }, []);

  async function runDiagnostic(method: string) {
    const diagnostics = getAdjutorixWindow().adjutorix?.diagnostics;
    const bridge = diagnostics?.[method];

    if (typeof bridge !== "function") {
      setLastRun({
        method,
        status: "failed",
        detail: `${method} bridge unavailable.`
      });
      return;
    }

    setLastRun({
      method,
      status: "running",
      detail: `${method} running.`
    });

    try {
      const result = await (bridge as () => Promise<unknown>)();
      setLastRun({
        method,
        status: "passed",
        detail: summarizeResult(result)
      });
    } catch (error) {
      setLastRun({
        method,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return (
    <section aria-label="Operator diagnostics console" className="operator-diagnostics-console">
      <header>
        <p>Operator Diagnostics Console</p>
        <h2>Runtime evidence before runtime trust.</h2>
        <p>
          Diagnostics, startup posture, logs, crash context, and export bundles are surfaced through one governed operator path.
        </p>
      </header>

      <dl aria-label="diagnostics bridge posture">
        <div>
          <dt>diagnostic bridges available</dt>
          <dd>{bridgePosture.availableCount}</dd>
        </div>
        <div>
          <dt>diagnostic bridges missing</dt>
          <dd>{bridgePosture.missingCount}</dd>
        </div>
        <div>
          <dt>operator hash bridge</dt>
          <dd>{bridgePosture.hasOperatorKernelHash ? "available" : "unavailable"}</dd>
        </div>
      </dl>

      <div aria-label="diagnostic commands">
        {diagnosticActions.map((action) => (
          <article key={action.method}>
            <h3>{action.label}</h3>
            <p>{action.purpose}</p>
            <button type="button" onClick={() => void runDiagnostic(action.method)}>
              Run {action.method}
            </button>
          </article>
        ))}
      </div>

      <aside aria-label="last diagnostic result">
        <h3>Last diagnostic result</h3>
        <p>{lastRun.method}</p>
        <p>{lastRun.status}</p>
        <pre>{lastRun.detail}</pre>
      </aside>
    </section>
  );
}
