import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(appRoot, "../..");

function readApp(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("operator mission control surface contract", () => {
  it("renders one user-visible mission-control path in the app surface", () => {
    const app = readApp("src/renderer/App.tsx");
    const component = readApp("src/renderer/components/OperatorMissionControlPanel.tsx");

    expect(app).toContain("OperatorMissionControlPanel");
    expect(component).toContain("data-testid=\"operator-mission-control-surface\"");
    expect(component).toContain("Operator Mission Control");
    expect(component).toContain("Workspace root");
    expect(component).toContain("Selected path");
    expect(component).toContain("Operator intent");
    expect(component).toContain("Command evidence");
    expect(component).toContain("Create governed operator receipt");
    expect(component).toContain("Apply readiness");
  });

  it("keeps mission control bound to operator kernel receipt bridge", () => {
    const component = readApp("src/renderer/components/OperatorMissionControlPanel.tsx");

    expect(component).toContain("createReceipt");
    expect(component).toContain("lastHash");
    expect(component).toContain("previousKernelHash");
    expect(component).toContain("receiptHash");
    expect(component).toContain("operatorKernelEvidenceRequired");
  });

  it("declares mission control as required runtime surface policy", () => {
    const policy = JSON.parse(readRepo("configs/runtime/operator_mission_control_surface_policy.json")) as {
      required: boolean;
      requires: string[];
      forbidden: string[];
    };

    expect(policy.required).toBe(true);
    expect(policy.requires).toContain("workspaceRoot visible before receipt creation");
    expect(policy.requires).toContain("receiptHash visible after receipt creation");
    expect(policy.forbidden).toContain("apply readiness without operator kernel receipt");
  });

  it("keeps the mission-control contract in the implemented Vitest suite", () => {
    const config = readApp("vitest.config.mjs");
    expect(config).toContain("tests/renderer/operator_mission_control_surface_contract.test.ts");
  });
});
