import { describe, expect, it } from "vitest";
import {
  computeWorkspaceScale,
  WORKSPACE_BASE_HEIGHT,
  WORKSPACE_BASE_WIDTH,
} from "./layout";

describe("computeWorkspaceScale", () => {
  it("keeps full scale when the viewport is large enough", () => {
    expect(computeWorkspaceScale(WORKSPACE_BASE_WIDTH, WORKSPACE_BASE_HEIGHT)).toBe(1);
    expect(computeWorkspaceScale(1600, 1000)).toBe(1);
  });

  it("scales down proportionally when width is the limiting side", () => {
    expect(computeWorkspaceScale(680, WORKSPACE_BASE_HEIGHT)).toBeCloseTo(0.5);
  });

  it("scales down proportionally when height is the limiting side", () => {
    expect(computeWorkspaceScale(WORKSPACE_BASE_WIDTH, 430)).toBeCloseTo(0.5);
  });

  it("falls back to full scale for invalid viewport sizes", () => {
    expect(computeWorkspaceScale(0, 860)).toBe(1);
    expect(computeWorkspaceScale(1360, 0)).toBe(1);
  });
});
