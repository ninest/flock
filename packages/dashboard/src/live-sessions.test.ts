import type { SessionSummary } from "@flock/shared"
import { describe, expect, it } from "vitest"
import { isLive, needsNextPage } from "./live-sessions.ts"

const session = (status: SessionSummary["status"]) => ({ status }) as SessionSummary

describe("isLive", () => {
  it("counts active and idle Sessions as live", () => {
    expect([session("active"), session("idle"), session("ended")].filter(isLive).map((s) => s.status)).toEqual(["active", "idle"])
  })
})

describe("needsNextPage", () => {
  it("asks for more while the whole page is live", () => {
    expect(needsNextPage({ sessions: [session("active"), session("idle")], nextCursor: "c" })).toBe(true)
  })
  it("stops at the first ended Session, since the list is newest activity first", () => {
    expect(needsNextPage({ sessions: [session("active"), session("ended")], nextCursor: "c" })).toBe(false)
  })
  it("stops on the last page", () => expect(needsNextPage({ sessions: [session("active")], nextCursor: null })).toBe(false))
})
