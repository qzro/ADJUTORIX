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
      className="adjutorix-live-kernel-cockpit adjutorix-live-kernel-cockpit--compact"
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
          are active.
        </p>
      </header>
      <div className="adjutorix-live-kernel-receipt-grid">
        <span>operatorKernel: {liveOperatorKernelReceipt.operatorKernel}</span>
        <span>operatorKernelReceiptId: {liveOperatorKernelReceipt.operatorKernelReceiptId}</span>
        <span>operatorKernelHash: {liveOperatorKernelReceipt.operatorKernelHash}</span>
        <span>previousKernelHash: {liveOperatorKernelReceipt.previousKernelHash}</span>
        <span>receiptHash: {liveOperatorKernelReceipt.receiptHash}</span>
        <span>Kernel-gated apply: active</span>
      </div>
    </section>
  );
}

export default function App(): JSX.Element {
  return (
    <main
      className="adjutorix-product-root adjutorix-product-root--workbench-first"
      data-operator-kernel={liveOperatorKernelReceipt.operatorKernel}
      data-operator-kernel-receipt-id={liveOperatorKernelReceipt.operatorKernelReceiptId}
      data-operator-kernel-hash={liveOperatorKernelReceipt.operatorKernelHash}
      data-previous-kernel-hash={liveOperatorKernelReceipt.previousKernelHash}
    >
      <section className="adjutorix-product-primary" aria-label="ADJUTORIX workbench">
        <AdjutorixPowerWorkbench />
      </section>

      <aside className="adjutorix-governance-strip" aria-label="ADJUTORIX governed status">
        <div>
          <strong>Governed</strong>
          <span>Kernel receipt bound</span>
        </div>
        <div>
          <strong>Verify</strong>
          <span>Before mutation</span>
        </div>
        <div>
          <strong>Apply</strong>
          <span>Blocked until approved</span>
        </div>
      </aside>

      <details className="adjutorix-governed-spine-drawer">
        <summary>
          <span>Governance spine</span>
          <strong>Ready</strong>
        </summary>
        <OperatorSurfaceSpinePanel
          missionControl={<OperatorMissionControlPanel />}
          liveKernelCockpit={<OperatorKernelLiveCockpit />}
          executionRunway={<OperatorExecutionRunwayPanel />}
          evidenceLedger={<OperatorEvidenceLedgerPanel />}
          diagnosticsConsole={<OperatorDiagnosticsConsolePanel />}
        />
      </details>

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
  );
}
