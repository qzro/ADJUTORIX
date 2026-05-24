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

describe("operator execution runway surface contract", () => {
  it("renders the user-visible execution runway inside the app surface", () => {
    const app = readApp("src/renderer/App.tsx");
    const component = readApp("src/renderer/components/OperatorExecutionRunwayPanel.tsx");

    expect(app).toContain("OperatorExecutionRunwayPanel");
    expect(component).toContain("ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE");
    expect(component).toContain("Create runway receipt");
    expect(component).toContain("Load previous kernel hash");
  });

  it("binds the runway to kernel receipt, patch apply, and verification evidence", () => {
    const component = readApp("src/renderer/components/OperatorExecutionRunwayPanel.tsx");

    expect(component).toContain("operatorKernel.createReceipt");
    expect(component).toContain("operatorKernel.lastHash");
    expect(component).toContain("patch.apply");
    expect(component).toContain("pnpm run verify");
    expect(component).toContain("operatorKernelReceiptId");
  });

  it("declares the runway as required runtime policy", () => {
    const policy = readRepo("configs/runtime/operator_execution_runway_surface_policy.json");

    expect(policy).toContain("ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE");
    expect(policy).toContain("anonymous patch apply");
    expect(policy).toContain("release without clean verified main");
  });

  it("keeps the runway contract in the implemented Vitest suite", () => {
    const config = readApp("vitest.config.mjs");

    expect(config).toContain("tests/renderer/operator_execution_runway_surface_contract.test.ts");
  });
});
