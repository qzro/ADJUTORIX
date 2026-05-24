import { useMemo, useState, type ReactElement } from "react";

type OperatorKernelBridge = {
  createReceipt?: (payload: Record<string, unknown>) => Promise<unknown>;
  lastHash?: (payload?: Record<string, unknown>) => Promise<unknown>;
};

type PatchBridge = {
  apply?: unknown;
};

type AdjutorixWindow = Window & {
  adjutorix?: {
    operatorKernel?: OperatorKernelBridge;
    patch?: PatchBridge;
  };
};

type RunwayStep = {
  id: string;
  title: string;
  operatorAction: string;
  evidence: string;
  gate: string;
};

const RUNWAY_STEPS: RunwayStep[] = [
  {
    id: "intent",
    title: "1. Declare operator intent",
    operatorAction: "Name the user-visible operation before touching apply authority.",
    evidence: "operatorKernel.createReceipt",
    gate: "intent must exist before execution",
  },
  {
    id: "patch",
    title: "2. Bind patch custody",
    operatorAction: "Carry kernel evidence into patch.apply instead of applying anonymous changes.",
    evidence: "patch.apply payload carries operatorKernelReceiptId",
    gate: "apply authority requires kernel evidence",
  },
  {
    id: "verify",
    title: "3. Verify the repository",
    operatorAction: "Run pnpm run verify and keep the phase summary attached to the operation.",
    evidence: "pnpm run verify",
    gate: "verification must pass before release",
  },
  {
    id: "release",
    title: "4. Publish locked evidence",
    operatorAction: "Only tag or release from clean main after finality and verification hold.",
    evidence: "tag + GitHub release + clean status",
    gate: "release requires clean terminal state",
  },
];

function getAdjutorixWindow(): AdjutorixWindow {
  return window as unknown as AdjutorixWindow;
}

export function OperatorExecutionRunwayPanel(): ReactElement {
  const [receiptState, setReceiptState] = useState<string>("No runway receipt created yet.");
  const [lastHashState, setLastHashState] = useState<string>("Previous kernel hash not loaded.");

  const bridgeStatus = useMemo(() => {
    const adjutorix = getAdjutorixWindow().adjutorix;
    const hasKernelReceipt = typeof adjutorix?.operatorKernel?.createReceipt === "function";
    const hasKernelHash = typeof adjutorix?.operatorKernel?.lastHash === "function";
    const hasPatchApply = typeof adjutorix?.patch?.apply === "function";

    return {
      hasKernelReceipt,
      hasKernelHash,
      hasPatchApply,
      ready: hasKernelReceipt && hasKernelHash && hasPatchApply,
    };
  }, []);

  async function createRunwayReceipt(): Promise<void> {
    const bridge = getAdjutorixWindow().adjutorix?.operatorKernel?.createReceipt;

    if (typeof bridge !== "function") {
      setReceiptState("operatorKernel.createReceipt bridge unavailable.");
      return;
    }

    const payload = {
      workspaceRoot: "ADJUTORIX_OPERATOR_SELECTED_WORKSPACE",
      selectedPath: null,
      operatorIntent: "ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE",
      intentText: "User-visible operator execution runway",
      operationKind: "mission-control-runway",
      workspaceTrusted: true,
      workspaceWritable: false,
      planId: "operator-execution-runway",
      patchCustodyId: "operator-execution-runway-patch-custody",
      verificationGateId: "pnpm-run-verify",
      applyGateId: "mandatory-operator-kernel-gate",
      commands: ["operatorKernel.createReceipt", "patch.apply", "pnpm run verify"],
      previousKernelHash: null,
    };

    try {
      const receipt = await bridge(payload);
      setReceiptState(JSON.stringify(receipt, null, 2));
    } catch (error) {
      setReceiptState(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadPreviousKernelHash(): Promise<void> {
    const bridge = getAdjutorixWindow().adjutorix?.operatorKernel?.lastHash;

    if (typeof bridge !== "function") {
      setLastHashState("operatorKernel.lastHash bridge unavailable.");
      return;
    }

    try {
      const result = await bridge({ workspaceRoot: "ADJUTORIX_OPERATOR_SELECTED_WORKSPACE" });
      setLastHashState(JSON.stringify(result, null, 2));
    } catch (error) {
      setLastHashState(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section
      data-adjutorix-surface="ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE"
      aria-label="Operator execution runway"
      style={{
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: 18,
        padding: 18,
        marginTop: 18,
        background: "rgba(15, 23, 42, 0.72)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <p style={{ margin: 0, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.72 }}>
            Operator Execution Runway
          </p>
          <h2 style={{ margin: "6px 0 8px" }}>Mission Control now has a governed execution path.</h2>
          <p style={{ margin: 0, maxWidth: 760, opacity: 0.82 }}>
            This surface makes the real route visible: declare intent, bind patch custody, verify,
            then publish release evidence from a clean locked state.
          </p>
        </div>

        <div
          data-adjutorix-runway-ready={bridgeStatus.ready ? "true" : "false"}
          style={{
            borderRadius: 999,
            padding: "8px 12px",
            border: "1px solid rgba(148, 163, 184, 0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {bridgeStatus.ready ? "RUNWAY READY" : "RUNWAY DEGRADED"}
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginTop: 16 }}>
        {RUNWAY_STEPS.map((step) => (
          <article
            key={step.id}
            data-adjutorix-runway-step={step.id}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(2, 6, 23, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>{step.title}</h3>
            <p style={{ margin: "0 0 10px", opacity: 0.84 }}>{step.operatorAction}</p>
            <p style={{ margin: "0 0 6px", fontSize: 13 }}>
              <strong>Evidence:</strong> {step.evidence}
            </p>
            <p style={{ margin: 0, fontSize: 13 }}>
              <strong>Gate:</strong> {step.gate}
            </p>
          </article>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <button type="button" onClick={createRunwayReceipt}>
          Create runway receipt
        </button>
        <button type="button" onClick={loadPreviousKernelHash}>
          Load previous kernel hash
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
        <pre data-adjutorix-runway-receipt style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {receiptState}
        </pre>
        <pre data-adjutorix-runway-previous-hash style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {lastHashState}
        </pre>
      </div>
    </section>
  );
}
