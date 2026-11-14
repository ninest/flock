import { describe, expect, it } from "vitest"
import { annotationEnvironments, environmentsLabel, fromLocalInput, linkParts, localBucket, placeAnnotations, toLocalInput } from "./annotations.ts"

const NY = "America/New_York"
const ms = (iso: string) => Date.parse(iso)

describe("localBucket", () => {
  it("names the local day, or the local hour on hourly charts", () => {
    expect(localBucket(ms("2026-03-02T04:59:00Z"), NY, "day")).toBe("2026-03-01")
    expect(localBucket(ms("2026-03-02T05:00:00Z"), NY, "day")).toBe("2026-03-02")
    expect(localBucket(ms("2026-03-10T14:37:00Z"), NY, "hour")).toBe("2026-03-10T10:00")
    expect(localBucket(ms("2026-03-10T04:05:00Z"), NY, "hour")).toBe("2026-03-10T00:00")
  })
})

describe("placeAnnotations", () => {
  const a = (id: string, iso: string) => ({ id, at: ms(iso) })
  it("puts each Annotation on its bucket, grouping those that share one, and skips any outside", () => {
    const buckets = ["2026-03-01", "2026-03-02", "2026-03-03"]
    const placed = placeAnnotations(
      [a("late", "2026-03-03T12:00:00Z"), a("one", "2026-03-01T12:00:00Z"), a("two", "2026-03-01T20:00:00Z"), a("out", "2026-03-05T12:00:00Z")],
      buckets,
      "day",
      NY
    )
    expect(placed.map((p) => [p.index, p.annotations.map((x) => x.id)])).toEqual([[0, ["one", "two"]], [2, ["late"]]])
  })
})

describe("local input", () => {
  it("shows an instant as the Project's wall-clock time, to the minute", () => {
    expect(toLocalInput(ms("2026-03-10T14:37:59Z"), NY)).toBe("2026-03-10T10:37")
    expect(toLocalInput(ms("2026-01-10T14:37:00Z"), "Asia/Kolkata")).toBe("2026-01-10T20:07")
  })
  it("reads a wall-clock time in the Project's time zone back as an instant, either side of a DST change", () => {
    expect(new Date(fromLocalInput("2026-03-07T10:37", NY)!).toISOString()).toBe("2026-03-07T15:37:00.000Z")
    expect(new Date(fromLocalInput("2026-03-10T10:37", NY)!).toISOString()).toBe("2026-03-10T14:37:00.000Z")
    expect(new Date(fromLocalInput("2026-01-10T20:07", "Asia/Kolkata")!).toISOString()).toBe("2026-01-10T14:37:00.000Z")
    expect(fromLocalInput("", NY)).toBeUndefined()
  })
})

describe("linkParts", () => {
  it("splits plain text into text and links, leaving trailing punctuation outside the link", () => {
    expect(linkParts("See https://news.ycombinator.com/item?id=1, and http://a.b/c.")).toEqual([
      { text: "See " },
      { text: "https://news.ycombinator.com/item?id=1", href: "https://news.ycombinator.com/item?id=1" },
      { text: ", and " },
      { text: "http://a.b/c", href: "http://a.b/c" },
      { text: "." }
    ])
    expect(linkParts("no links")).toEqual([{ text: "no links" }])
    expect(linkParts("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }])
  })
})

describe("annotationEnvironments", () => {
  it("is all, or the chosen Environments, and undefined for an empty choice", () => {
    expect(annotationEnvironments("all", ["env_dev"])).toBe("all")
    expect(annotationEnvironments("some", ["env_dev", "env_staging"])).toEqual(["env_dev", "env_staging"])
    expect(annotationEnvironments("some", [])).toBeUndefined()
  })
})

describe("environmentsLabel", () => {
  const environments = [{ id: "env_prod", name: "production" }, { id: "env_dev", name: "dev" }, { id: "env_staging", name: "staging" }]
  it("reads All Environments, or the chosen names in the Project's order", () => {
    expect(environmentsLabel("all", environments)).toBe("All Environments")
    expect(environmentsLabel(["env_staging", "env_prod"], environments)).toBe("production, staging")
    expect(environmentsLabel(["env_dev"], environments)).toBe("dev")
  })
})
