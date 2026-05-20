import "@testing-library/jest-dom/vitest";

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocalOperatorCockpit } from "../../src/renderer/components/LocalOperatorCockpit";

function text(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getButton(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

function clickIfEnabled(name: RegExp): void {
  const button = getButton(name) as HTMLButtonElement;
  expect(button).toBeInTheDocument();
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
}

describe("smoke/local_operator_loop", () => {
  afterEach(() => {
    cleanup();
  });

  it("boots the local governed operator cockpit as the default product surface", async () => {
    render(<LocalOperatorCockpit />);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX Operator Cockpit/i);
      expect(text()).toMatch(/Local governed coding control plane/i);
      expect(text()).toMatch(/Repository custody/i);
      expect(text()).toMatch(/Trust classification/i);
      expect(text()).toMatch(/Intent capture/i);
      expect(text()).toMatch(/Plan object/i);
      expect(text()).toMatch(/Patch object/i);
      expect(text()).toMatch(/Verification Gate object/i);
      expect(text()).toMatch(/Verify receipt/i);
      expect(text()).toMatch(/Apply Gate object/i);
      expect(text()).toMatch(/Apply Receipt object/i);
      expect(text()).toMatch(/Rollback Gate object/i);
      expect(text()).toMatch(/Rollback Receipt object/i);
      expect(text()).toMatch(/Evidence timeline/i);
    });
  });

  it("executes the complete governed loop without terminal dependency", async () => {
    render(<LocalOperatorCockpit />);

    clickIfEnabled(/open repository/i);

    await waitFor(() => {
      expect(text()).toMatch(/READY_FOR_INTENT|Repository custody|Trust classification/i);
    });

    const intent =
      screen.queryByRole("textbox", { name: /intent/i }) ??
      screen.queryByPlaceholderText(/intent|change|request/i) ??
      screen.getByRole("textbox");

    fireEvent.change(intent, {
      target: {
        value:
          "Add a deterministic operator-loop smoke proof without mutating repository files.",
      },
    });

    clickIfEnabled(/create plan/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_INTENT_PLAN_OBJECT|Plan object/i);
    });

    clickIfEnabled(/create patch custody/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_PATCH_CUSTODY_OBJECT|Patch object custody|Patch custody/i);
    });

    clickIfEnabled(/create verification gate/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_VERIFICATION_GATE_OBJECT|Verification Gate object/i);
    });

    clickIfEnabled(/bind verification/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_VERIFY_RECEIPT_OBJECT|Verify receipt/i);
      expect(text()).toMatch(/READY_TO_APPLY|PASS/i);
    });

    clickIfEnabled(/create apply gate/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_APPLY_GATE_OBJECT|Apply Gate object/i);
    });

    clickIfEnabled(/apply with receipt/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_APPLY_RECEIPT_OBJECT|Apply Receipt object/i);
      expect(text()).toMatch(/ROLLBACK_AVAILABLE|rollback available/i);
    });

    clickIfEnabled(/create rollback gate/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_ROLLBACK_GATE_OBJECT|Rollback Gate object/i);
    });

    clickIfEnabled(/rollback with receipt/i);

    await waitFor(() => {
      expect(text()).toMatch(/ADJUTORIX_ROLLBACK_RECEIPT_OBJECT|Rollback Receipt object/i);
      expect(text()).toMatch(/ROLLBACK_COMPLETE/i);
      expect(text()).toMatch(/operator_loop_complete|terminal_state|rollback receipt/i);
    });
  });

  it("keeps apply blocked before verify receipt and keeps rollback blocked before apply receipt", async () => {
    render(<LocalOperatorCockpit />);

    expect(getButton(/apply with receipt/i)).toBeDisabled();
    expect(getButton(/rollback with receipt/i)).toBeDisabled();

    clickIfEnabled(/open repository/i);

    const intent =
      screen.queryByRole("textbox", { name: /intent/i }) ??
      screen.queryByPlaceholderText(/intent|change|request/i) ??
      screen.getByRole("textbox");

    fireEvent.change(intent, {
      target: {
        value: "Prove gated operator flow.",
      },
    });

    clickIfEnabled(/create plan/i);
    clickIfEnabled(/create patch custody/i);
    clickIfEnabled(/create verification gate/i);

    await waitFor(() => {
      expect(getButton(/apply with receipt/i)).toBeDisabled();
      expect(getButton(/rollback with receipt/i)).toBeDisabled();
    });
  });
});
