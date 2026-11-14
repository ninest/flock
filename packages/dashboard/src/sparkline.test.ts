import { describe, expect, it } from "vitest"
import { sparklinePoints } from "./sparkline.ts"

describe("sparklinePoints", () => {
  it("spreads the values across the width, with the highest at the top", () =>
    expect(sparklinePoints([0, 5, 10], 100, 20)).toBe("1,19 50,10 99,1"))

  it("draws all zeros as a flat line along the bottom", () =>
    expect(sparklinePoints([0, 0, 0], 100, 20)).toBe("1,19 50,19 99,19"))

  it("draws a single value as a flat line across", () =>
    expect(sparklinePoints([4], 100, 20)).toBe("1,1 99,1"))

  it("draws nothing without values", () => expect(sparklinePoints([], 100, 20)).toBe(""))
})
