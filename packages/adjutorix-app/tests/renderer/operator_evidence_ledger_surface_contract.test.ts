import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("operator evidence ledger surface contract", () => {
  it("renders a user-visible evidence ledger surface inside the app", () => {
    const component = read("packages/adjutorix-app/src/renderer/components/OperatorEvidenceLedgerPanel.tsx");
    const app = read("packages/adjutorix-app/src/renderer/App.tsx");

    expect(component).toContain("operator-evidence-ledger-surface");
    expect(component).toContain("Operator Evidence Ledger");
    expect(app).toContain("OperatorEvidenceLedgerPanel");
    expect(app).toContain("<OperatorEvidenceLedgerPanel />");
  });

  it("binds the surface to every governed ledger bridge path", () => {
    const component = read("packages/adjutorix-app/src/renderer/components/OperatorEvidenceLedgerPanel.tsx");

    expect(component).toContain("adjutorix?.ledger");
    expect(component).toContain("ledger.timeline");
    expect(component).toContain("ledger.heads");
    expect(component).toContain("ledger.stats");
    expect(component).toContain("ledger.entry");
  });

  it("declares the evidence ledger as required runtime surface policy", () => {
    const policy = read("configs/runtime/operator_evidence_ledger_surface_policy.json");

    expect(policy).toContain("operator_evidence_ledger_surface");
    expect(policy).toContain("adjutorix:ledger:timeline");
    expect(policy).toContain("adjutorix:ledger:heads");
    expect(policy).toContain("adjutorix:ledger:stats");
    expect(policy).toContain("adjutorix:ledger:entry");
    expect(policy).toContain('"mustRemainUserVisible": true');
  });

  it("keeps the ledger surface contract in the implemented Vitest suite", () => {
    const vitest = read("packages/adjutorix-app/vitest.config.mjs");

    expect(vitest).toContain("operator_evidence_ledger_surface_contract.test.ts");
  });
});
