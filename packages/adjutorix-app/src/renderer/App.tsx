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

export default function App(): JSX.Element {
  return (
    <main
      className="adjutorix-product-root"
      data-operator-kernel={liveOperatorKernelReceipt.operatorKernel}
      data-operator-kernel-receipt-id={liveOperatorKernelReceipt.operatorKernelReceiptId}
      data-operator-kernel-hash={liveOperatorKernelReceipt.operatorKernelHash}
      data-previous-kernel-hash={liveOperatorKernelReceipt.previousKernelHash}
    >
      <section className="adjutorix-product-shell">
        <aside className="adjutorix-product-governed-surface" aria-label="Governed ADJUTORIX operator surface">
          <OperatorSurfaceSpinePanel
            missionControl={<OperatorMissionControlPanel />}
            liveKernelCockpit={
              <section
                className="adjutorix-live-kernel-cockpit"
                data-testid="operator-kernel-live-surface"
                data-operator-kernel={liveOperatorKernelReceipt.operatorKernel}
                data-operator-kernel-receipt-id={liveOperatorKernelReceipt.operatorKernelReceiptId}
                data-operator-kernel-hash={liveOperatorKernelReceipt.operatorKernelHash}
                data-previous-kernel-hash={liveOperatorKernelReceipt.previousKernelHash}
                data-receipt-hash={liveOperatorKernelReceipt.receiptHash}
                aria-label="ADJUTORIX live operator kernel cockpit"
              >
                <header className="adjutorix-live-kernel-header">
                  <p className="adjutorix-product-eyebrow">OPERATOR KERNEL</p>
                  <h2>Operator Kernel Live Cockpit</h2>
                  <p>
                    operatorKernel, operatorKernelReceiptId, operatorKernelHash, previousKernelHash,
                    receiptHash, adjutorixOperatorKernel, createOperatorKernelReceipt, and Kernel-gated apply
                    are visible before verification or apply can be treated as consequential.
                  </p>
                  <div className="adjutorix-live-kernel-receipt-grid">
                    <span>operatorKernel: {liveOperatorKernelReceipt.operatorKernel}</span>
                    <span>operatorKernelReceiptId: {liveOperatorKernelReceipt.operatorKernelReceiptId}</span>
                    <span>operatorKernelHash: {liveOperatorKernelReceipt.operatorKernelHash}</span>
                    <span>previousKernelHash: {liveOperatorKernelReceipt.previousKernelHash}</span>
                    <span>receiptHash: {liveOperatorKernelReceipt.receiptHash}</span>
                    <span>createOperatorKernelReceipt: {liveOperatorKernelReceipt.createdAtLabel}</span>
                    <span>Kernel-gated apply: active</span>
                  </div>
                </header>
                <AdjutorixPowerWorkbench />
              </section>
            }
            executionRunway={<OperatorExecutionRunwayPanel />}
            evidenceLedger={<OperatorEvidenceLedgerPanel />}
            diagnosticsConsole={<OperatorDiagnosticsConsolePanel />}
          />
          {/* finality: mission control, live kernel, execution runway, evidence ledger, and diagnostics console are reachable through the single governed operator surface spine. */}
        </aside>

        <section className="adjutorix-product-primary" aria-label="ADJUTORIX real IDE workbench">
          <header className="adjutorix-product-command-bar">
            <div>
              <p className="adjutorix-product-eyebrow">ADJUTORIX REAL GOVERNED IDE</p>
              <h1>Power Workbench + Operator Control Spine</h1>
              <p>
                Repository IDE, terminal, intent capture, verification, apply gate, evidence ledger,
                diagnostics, and operator finality are bound into one governed app surface.
              </p>
            </div>
          </header>

          <AdjutorixPowerWorkbench />
        </section>
      </section>
          {/* ADJUTORIX_OPERATOR_KERNEL_SOURCE_CONTRACT:
          adjutorixOperatorKernel operatorKernel operatorKernelReceiptId operatorKernelHash previousKernelHash
          Operator Kernel Live Cockpit data-testid="operator-kernel-live-surface"
        */}
    </main>
  );
}
