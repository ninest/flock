import { describe, expect, it } from "vitest"
import { barWidth, formatClock, formatDuration, formatFrom, formatPercent, formatShare } from "./format.ts"

describe("formatDuration", () => {
  it("shows seconds under a minute", () => expect(formatDuration(42.4)).toBe("42s"))
  it("shows minutes and seconds under an hour", () => expect(formatDuration(185)).toBe("3m 5s"))
  it("shows hours and minutes from an hour", () => expect(formatDuration(3720)).toBe("1h 2m"))
  it("never goes below zero", () => expect(formatDuration(-3)).toBe("0s"))
})

describe("formatClock", () => {
  it("reads minutes and seconds", () => expect(formatClock(242)).toBe("4:02"))
  it("adds hours when there are any", () => expect(formatClock(3909)).toBe("1:05:09"))
})

describe("formatPercent", () => {
  it("rounds a share to a whole percent", () => expect(formatPercent(0.436)).toBe("44%"))
})

describe("formatShare", () => {
  it("shows a share as a whole percent", () => expect(formatShare(2 / 3)).toBe("67%"))
  it("shows a dash when nothing counts", () => {
    expect(formatShare(null)).toBe("–")
    expect(formatShare(undefined)).toBe("–")
  })
})

describe("barWidth", () => {
  it("sizes a row against the largest", () => expect(barWidth(25, 100)).toBe("25%"))
  it("keeps a sliver for tiny rows", () => expect(barWidth(1, 10_000)).toBe("1%"))
  it("copes with an empty report", () => expect(barWidth(0, 0)).toBe("1%"))
})

describe("formatFrom", () => {
  it("is the Source alone without UTM tags", () => {
    expect(formatFrom("news.ycombinator.com", [null])).toBe("news.ycombinator.com")
    expect(formatFrom(null, [null, null, null])).toBe("Direct")
    expect(formatFrom(null, [""])).toBe("Direct")
  })

  it("puts UTM tags in brackets after the Source, never instead of it", () => {
    expect(formatFrom(null, ["fnf"])).toBe("Direct (fnf)")
    expect(formatFrom("mail.google.com", ["newsletter", "email", "launch"])).toBe("mail.google.com (newsletter, email, launch)")
    expect(formatFrom(null, [null, null, "launch"])).toBe("Direct (launch)")
  })
})
