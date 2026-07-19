import React from "react";
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

// MOVE214_PROVIDER_TOPOLOGY_FALLBACK_TEST=true

// MOVE214_WORKFLOW_ACCESSIBLE_TEST_FIXED=true

function appendSurface(
  identifier: string,
  title: string,
  description: string,
): HTMLElement {
  const section = document.createElement("section");

  section.id = identifier;
  section.style.position = "fixed";
  section.innerHTML = `
    <article>
      <h2>${title}</h2>
      <p>${description}</p>
    </article>
  `;

  document.body.append(section);

  return section;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("ProductSurfaceOrchestrator", () => {
  it("consolidates the primary product tools into one guided workflow", async () => {
    const provider = appendSurface(
      "adjutorix-ai-live-conversation-surface",
      "Integrated Assistant",
      "Ask for a code action or diagnosis.",
    );

    const context = appendSurface(
      "adjutorix-ai-workspace-context-pack",
      "Workspace Context",
      "Select project context for the task.",
    );

    const patch = appendSurface(
      "adjutorix-ai-patch-runway",
      "AI Patch Runway",
      "Build a governed code change.",
    );

    const verify = appendSurface(
      "adjutorix-ai-patch-verify-runway",
      "Patch Verify",
      "Verify the proposed change.",
    );

    render(<ProductSurfaceOrchestrator />);

    await waitFor(() => {
      expect(patch.dataset.adjutorixSurfaceManaged).toBe("true");
    });

    for (const surface of [provider, context, patch, verify]) {
      expect(surface.dataset.adjutorixSurfaceActive).toBe("false");
      expect(surface.getAttribute("aria-hidden")).toBe("true");
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Adjutorix guided workspace",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Select Build workflow",
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open AI Patch Runway",
      }),
    );

    await waitFor(() => {
      expect(patch.dataset.adjutorixSurfaceActive).toBe("true");
    });

    expect(provider.dataset.adjutorixSurfaceActive).toBe("false");

    expect(context.dataset.adjutorixSurfaceActive).toBe("false");

    expect(verify.dataset.adjutorixSurfaceActive).toBe("false");

    fireEvent.keyDown(window, {
      key: "Escape",
    });

    await waitFor(() => {
      expect(patch.dataset.adjutorixSurfaceActive).toBe("false");
    });
  });

  it("preserves legacy authority filtering and single-surface activation", async () => {
    const authority = appendSurface(
      "adjutorix-ai-runway-test-archive-bundle-verifier",
      "Archive Bundle Verifier",
      "Verifies the retained SHA-256 authority chain.",
    );

    render(<ProductSurfaceOrchestrator />);

    await waitFor(() => {
      expect(authority.dataset.adjutorixSurfaceManaged).toBe("true");
    });

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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open Archive Bundle Verifier",
      }),
    );

    await waitFor(() => {
      expect(authority.dataset.adjutorixSurfaceActive).toBe("true");
    });

    expect(authority.getAttribute("aria-hidden")).toBe("false");
  });

  it("opens through both global product events", async () => {
    appendSurface(
      "adjutorix-ai-live-conversation-surface",
      "Integrated Assistant",
      "Ask for a governed action.",
    );

    render(<ProductSurfaceOrchestrator />);

    act(() => {
      window.dispatchEvent(new Event("adjutorix:guided-product-shell:open"));
    });

    expect(
      await screen.findByRole("complementary", {
        name: "Adjutorix guided product shell",
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close Adjutorix power deck",
      }),
    );

    act(() => {
      window.dispatchEvent(new Event("adjutorix:product-command-deck:toggle"));
    });

    expect(
      await screen.findByRole("complementary", {
        name: "Adjutorix guided product shell",
      }),
    ).toBeTruthy();
  });
});
