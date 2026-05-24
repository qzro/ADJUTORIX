import { useMemo, useState } from "react";

type MissionReceiptState = {
  ok: boolean;
  receiptHash: string | null;
  previousKernelHash: string | null;
  error: string | null;
};

type KernelBridge = {
  createReceipt?: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
  lastHash?: (payload?: Record<string, unknown>) => Promise<unknown> | unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNestedRecord(root: unknown, keys: string[]): Record<string, unknown> {
  let current: unknown = root;
  for (const key of keys) {
    current = asRecord(current)[key];
  }
  return asRecord(current);
}

function findKernelBridge(): KernelBridge {
  const globalRecord = asRecord(globalThis);
  const windowRecord = asRecord(globalRecord.window);
  const adjutorix = asRecord(windowRecord.adjutorix);
  const adjutorixApi = asRecord(windowRecord.adjutorixApi);

  const candidates = [
    readNestedRecord(adjutorix, ["operatorKernel"]),
    readNestedRecord(adjutorixApi, ["operatorKernel"]),
    readNestedRecord(adjutorix, ["kernel"]),
    readNestedRecord(adjutorixApi, ["kernel"]),
  ];

  for (const candidate of candidates) {
    if (typeof candidate.createReceipt === "function" || typeof candidate.lastHash === "function") {
      return candidate as KernelBridge;
    }
  }

  return {};
}

function extractHash(value: unknown): string | null {
  const record = asRecord(value);
  const data = asRecord(record.data);
  const candidates = [
    record.receiptHash,
    record.kernelHash,
    record.hash,
    data.receiptHash,
    data.kernelHash,
    data.hash,
    data.previousKernelHash,
    record.previousKernelHash,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function splitCommands(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function OperatorMissionControlPanel(): JSX.Element {
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [operatorIntent, setOperatorIntent] = useState("Review, verify, and apply only through the governed operator kernel.");
  const [planId, setPlanId] = useState("");
  const [patchCustodyId, setPatchCustodyId] = useState("");
  const [verificationGateId, setVerificationGateId] = useState("");
  const [applyGateId, setApplyGateId] = useState("");
  const [commandsText, setCommandsText] = useState("");
  const [receiptState, setReceiptState] = useState<MissionReceiptState>({
    ok: false,
    receiptHash: null,
    previousKernelHash: null,
    error: null,
  });

  const bridge = useMemo(() => findKernelBridge(), []);

  const payload = useMemo(
    () => ({
      workspaceRoot,
      selectedPath: selectedPath || null,
      operatorIntent,
      intentText: operatorIntent,
      operationKind: "operator-mission-control",
      planId: planId || null,
      patchCustodyId: patchCustodyId || null,
      verificationGateId: verificationGateId || null,
      applyGateId: applyGateId || null,
      commands: splitCommands(commandsText),
      workspaceTrusted: true,
      workspaceWritable: true,
      userVisibleSurface: "operator-mission-control",
      operatorKernelEvidenceRequired: true,
    }),
    [
      workspaceRoot,
      selectedPath,
      operatorIntent,
      planId,
      patchCustodyId,
      verificationGateId,
      applyGateId,
      commandsText,
    ],
  );

  async function loadPreviousHash(): Promise<void> {
    try {
      if (typeof bridge.lastHash !== "function") {
        throw new Error("Operator kernel lastHash bridge is not available.");
      }

      const result = await bridge.lastHash({ workspaceRoot });
      setReceiptState((current) => ({
        ...current,
        previousKernelHash: extractHash(result),
        error: null,
      }));
    } catch (error) {
      setReceiptState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Unable to read previous operator kernel hash.",
      }));
    }
  }

  async function createReceipt(): Promise<void> {
    try {
      if (typeof bridge.createReceipt !== "function") {
        throw new Error("Operator kernel createReceipt bridge is not available.");
      }

      const result = await bridge.createReceipt({
        ...payload,
        previousKernelHash: receiptState.previousKernelHash,
      });

      setReceiptState({
        ok: true,
        receiptHash: extractHash(result),
        previousKernelHash: receiptState.previousKernelHash,
        error: null,
      });
    } catch (error) {
      setReceiptState({
        ok: false,
        receiptHash: null,
        previousKernelHash: receiptState.previousKernelHash,
        error: error instanceof Error ? error.message : "Operator kernel receipt creation failed.",
      });
    }
  }

  return (
    <section
      aria-label="Operator Mission Control"
      data-testid="operator-mission-control-surface"
      className="operator-mission-control-surface"
    >
      <header>
        <p className="eyebrow">Operator Mission Control</p>
        <h2>One governed path from intent to kernel receipt</h2>
        <p>
          Workspace, target path, operator intent, command evidence, previous kernel hash, and apply readiness are visible before authority crosses the patch boundary.
        </p>
      </header>

      <div className="operator-mission-control-grid">
        <label>
          Workspace root
          <input
            aria-label="Operator workspace root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            placeholder="/absolute/workspace/root"
          />
        </label>

        <label>
          Selected path
          <input
            aria-label="Operator selected path"
            value={selectedPath}
            onChange={(event) => setSelectedPath(event.target.value)}
            placeholder="relative/or/absolute/path"
          />
        </label>

        <label>
          Plan ID
          <input
            aria-label="Operator plan id"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            placeholder="plan identifier"
          />
        </label>

        <label>
          Patch custody ID
          <input
            aria-label="Patch custody id"
            value={patchCustodyId}
            onChange={(event) => setPatchCustodyId(event.target.value)}
            placeholder="patch custody identifier"
          />
        </label>

        <label>
          Verification gate ID
          <input
            aria-label="Verification gate id"
            value={verificationGateId}
            onChange={(event) => setVerificationGateId(event.target.value)}
            placeholder="verify gate identifier"
          />
        </label>

        <label>
          Apply gate ID
          <input
            aria-label="Apply gate id"
            value={applyGateId}
            onChange={(event) => setApplyGateId(event.target.value)}
            placeholder="apply gate identifier"
          />
        </label>
      </div>

      <label>
        Operator intent
        <textarea
          aria-label="Operator intent"
          value={operatorIntent}
          onChange={(event) => setOperatorIntent(event.target.value)}
          rows={3}
        />
      </label>

      <label>
        Command evidence
        <textarea
          aria-label="Command evidence"
          value={commandsText}
          onChange={(event) => setCommandsText(event.target.value)}
          placeholder="one command per line"
          rows={5}
        />
      </label>

      <div className="operator-mission-control-actions">
        <button type="button" onClick={loadPreviousHash}>
          Load previous kernel hash
        </button>
        <button type="button" onClick={createReceipt}>
          Create governed operator receipt
        </button>
      </div>

      <dl className="operator-mission-control-receipt">
        <div>
          <dt>Previous kernel hash</dt>
          <dd>{receiptState.previousKernelHash ?? "not loaded"}</dd>
        </div>
        <div>
          <dt>Receipt hash</dt>
          <dd>{receiptState.receiptHash ?? "not created"}</dd>
        </div>
        <div>
          <dt>Apply readiness</dt>
          <dd>{receiptState.ok ? "kernel evidence ready" : "blocked until receipt exists"}</dd>
        </div>
      </dl>

      {receiptState.error ? (
        <p role="alert" className="operator-mission-control-error">
          {receiptState.error}
        </p>
      ) : null}
    </section>
  );
}
