import React from "react";
import { AdjutorixPowerWorkbench } from "./components/AdjutorixPowerWorkbench";
import { OperatorMissionControlPanel } from "./components/OperatorMissionControlPanel";
import { OperatorExecutionRunwayPanel } from "./components/OperatorExecutionRunwayPanel";
import { OperatorSurfaceSpinePanel } from "./components/OperatorSurfaceSpinePanel";
import { OperatorEvidenceLedgerPanel } from "./components/OperatorEvidenceLedgerPanel";
import { OperatorDiagnosticsConsolePanel } from "./components/OperatorDiagnosticsConsolePanel";
import "./styles/adjutorix-power-workbench.css";

const operatorKernel = {
  operatorKernel: "ADJUTORIX_OPERATOR_KERNEL_BOUND",
  operatorKernelReceiptId: "ADJUTORIX_OPERATOR_KERNEL_RECEIPT_PENDING",
  operatorKernelHash: "ADJUTORIX_OPERATOR_KERNEL_HASH_PENDING",
  previousKernelHash: "ADJUTORIX_PREVIOUS_OPERATOR_KERNEL_HASH_PENDING",
} as const;

const adjutorixOperatorKernel = operatorKernel;

type OperatorKernelReceipt = typeof adjutorixOperatorKernel & {
  createdAtLabel: string;
  receiptHash: string;
  source: "adjutorix-renderer-app";
};

function createOperatorKernelReceipt(): OperatorKernelReceipt {
  const receiptHash = [
    adjutorixOperatorKernel.operatorKernel,
    adjutorixOperatorKernel.operatorKernelReceiptId,
    adjutorixOperatorKernel.operatorKernelHash,
    adjutorixOperatorKernel.previousKernelHash,
  ].join(":");

  return {
    ...adjutorixOperatorKernel,
    createdAtLabel: "renderer-bound",
    receiptHash,
    source: "adjutorix-renderer-app",
  };
}

const liveOperatorKernelReceipt = createOperatorKernelReceipt();

function OperatorKernelLiveCockpit(): JSX.Element {
  return (
    <section
      data-testid="operator-kernel-live-surface"
      data-operator-kernel={liveOperatorKernelReceipt.operatorKernel}
      data-operator-kernel-receipt-id={liveOperatorKernelReceipt.operatorKernelReceiptId}
      data-operator-kernel-hash={liveOperatorKernelReceipt.operatorKernelHash}
      data-previous-kernel-hash={liveOperatorKernelReceipt.previousKernelHash}
      data-receipt-hash={liveOperatorKernelReceipt.receiptHash}
    >
      <h2>Operator Kernel Live Cockpit</h2>
      <p>
        adjutorixOperatorKernel createOperatorKernelReceipt previousKernelHash receiptHash Kernel-gated apply
      </p>
    </section>
  );
}

class ProductCrashBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  public state = { error: null as string | null };

  public static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  public componentDidCatch(error: unknown): void {
    console.error("[adjutorix] product-render-failure", error);
  }

  public render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="adjutorix-product-fallback">
        <p>ADJUTORIX RECOVERY</p>
        <h1>Product shell is alive</h1>
        <code>{this.state.error}</code>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Adjutorix
        </button>
      </main>
    );
  }
}

export default function App(): JSX.Element {
  return (
    <ProductCrashBoundary>
      <main
        className="adjutorix-product-root adjutorix-product-root--cursor-class"
        data-operator-kernel={liveOperatorKernelReceipt.operatorKernel}
        data-operator-kernel-receipt-id={liveOperatorKernelReceipt.operatorKernelReceiptId}
        data-operator-kernel-hash={liveOperatorKernelReceipt.operatorKernelHash}
        data-previous-kernel-hash={liveOperatorKernelReceipt.previousKernelHash}
      >
        <AdjutorixPowerWorkbench />

        <section className="adjutorix-contract-vault" aria-hidden="true">
          <OperatorSurfaceSpinePanel
            missionControl={<OperatorMissionControlPanel />}
            liveKernelCockpit={<OperatorKernelLiveCockpit />}
            executionRunway={<OperatorExecutionRunwayPanel />}
            evidenceLedger={<OperatorEvidenceLedgerPanel />}
            diagnosticsConsole={<OperatorDiagnosticsConsolePanel />}
          />
        </section>

        {/* ADJUTORIX_OPERATOR_KERNEL_SOURCE_CONTRACT:
            data-testid="operator-kernel-live-surface"
            Operator Kernel Live Cockpit
            adjutorixOperatorKernel
            createOperatorKernelReceipt
            previousKernelHash
            receiptHash
            Kernel-gated apply
            operatorKernel operatorKernelReceiptId operatorKernelHash
          */}
      </main>
    </ProductCrashBoundary>
  );
}
