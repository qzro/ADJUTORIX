/**
 * Contract test: single source of truth for protocol version.
 * Would have caught PROTOCOL_VERSION = 2 drift in sidebarView.
 */
import { describe, expect, it } from "vitest";
import { ENGINE_PROTOCOL_VERSION } from "./engineProtocol";

describe("engine protocol contract", () => {
  it("ENGINE_PROTOCOL_VERSION is 1 (controller gate and agent must match)", () => {
    expect(ENGINE_PROTOCOL_VERSION).toBe(1);
  });
});
