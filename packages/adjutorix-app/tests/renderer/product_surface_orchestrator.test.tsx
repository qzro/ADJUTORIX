import React from "react";

// MOVE213_PRODUCT_TEST_SEMANTICS_FIXED=true
// MOVE213_PRODUCT_TEST_ACCESSIBLE_QUERY_FIXED=true
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductSurfaceOrchestrator } from "../../src/renderer/components/ProductSurfaceOrchestrator";

afterEach(() => {
  cleanup();

  document
    .querySelectorAll('[id^="adjutorix-ai-runway-test-"]')
    .forEach((element) => element.remove());

  document.body.classList.remove("adjutorix-product-command-deck-mode");
});

describe("ProductSurfaceOrchestrator", () => {
  it("keeps all powers mounted while exposing only the selected surface", async () => {
    const legacySurface = document.createElement("section");

    legacySurface.id = "adjutorix-ai-runway-test-archive-bundle-verifier";

    legacySurface.innerHTML = `
      <article>
        <h2>Archive Bundle Verifier</h2>
        <p>Verifies the retained SHA-256 authority chain.</p>
      </article>
    `;

    document.body.appendChild(legacySurface);

    render(<ProductSurfaceOrchestrator />);

    await waitFor(() => {
      expect(legacySurface.getAttribute("data-adjutorix-surface-managed")).toBe(
        "true",
      );
    });

    expect(legacySurface.getAttribute("data-adjutorix-surface-active")).toBe(
      "false",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Adjutorix power deck",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Verify",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Open Archive Bundle Verifier",
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Archive Bundle Verifier",
      }),
    );

    await waitFor(() => {
      expect(legacySurface.getAttribute("data-adjutorix-surface-active")).toBe(
        "true",
      );
    });

    expect(legacySurface.getAttribute("aria-hidden")).toBe("false");

    fireEvent.keyDown(window, {
      key: "Escape",
    });

    await waitFor(() => {
      expect(legacySurface.getAttribute("data-adjutorix-surface-active")).toBe(
        "false",
      );
    });

    expect(legacySurface.getAttribute("aria-hidden")).toBe("true");

    expect(document.body.contains(legacySurface)).toBe(true);
  });

  it("opens through the global product command event", async () => {
    render(<ProductSurfaceOrchestrator />);

    act(() => {
      window.dispatchEvent(new Event("adjutorix:product-command-deck:toggle"));
    });

    expect(
      await screen.findByRole("complementary", {
        name: "Adjutorix power command deck",
      }),
    ).toBeTruthy();
  });
});
