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

describe("operator kernel mandatory gate contract", () => {
  it("keeps the real operator kernel wired through main IPC and preload", () => {
    const main = readApp("src/main/index.ts");
    const ipc = readApp("src/main/ipc/operator_kernel_ipc.ts");
    const preload = readApp("src/preload/preload.ts");

    expect(main).toContain("registerOperatorKernelIpc");
    expect(ipc).toContain("registerOperatorKernelIpc");
    expect(ipc).toContain("adjutorix:operatorKernel:createReceipt");
    expect(ipc).toContain("adjutorix:operatorKernel:lastHash");
    expect(ipc).toContain("createOperatorKernelReceipt");
    expect(ipc).toContain("readLastOperatorKernelHash");
    expect(preload).toContain("operatorKernel");
    expect(preload).toContain("adjutorix:operatorKernel:createReceipt");
    expect(preload).toContain("adjutorix:operatorKernel:lastHash");
  });

  it("declares the mandatory kernel gate as runtime policy", () => {
    const policy = readRepo("configs/runtime/operator_kernel_mandatory_gate_policy.json");
    const assertion = readRepo("scripts/product/assert-operator-kernel-mandatory-gate.mjs");

    expect(policy).toContain("MANDATORY_OPERATOR_KERNEL_GATE");
    expect(policy).toContain("missing_main_registration");
    expect(policy).toContain("missing_preload_surface");
    expect(policy).toContain("missing_contract_test");

    expect(assertion).toContain("ADJUTORIX_OPERATOR_KERNEL_MANDATORY_GATE_READINESS");
    expect(assertion).toContain("operator_kernel_mandatory_gate_readiness.v1");
    expect(assertion).toContain("registerOperatorKernelIpc");
    expect(assertion).toContain("adjutorix:operatorKernel:createReceipt");
  });
});
