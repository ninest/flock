import { describe, expect, it } from "vitest"
import { visitorName } from "./visitor-name.ts"

describe("visitorName", () => {
  it("gives the same name for the same Visitor ID, every time", () => {
    const id = "0b9c6f7e-3d1a-4c55-9a0e-6f1d2b3c4d5e"
    expect(visitorName(id)).toBe(visitorName(id))
  })

  it("keeps today's names, so a Visitor stays recognisable across releases", () => {
    // Pinned: changing the word lists or the hash renames every anonymous Visitor.
    expect(visitorName("device-1")).toBe("Merry Owl")
    expect(visitorName("0b9c6f7e-3d1a-4c55-9a0e-6f1d2b3c4d5e")).toBe("Golden Weasel")
  })

  it("is two capitalised words: an adjective and an animal", () => {
    for (const id of ["a", "device-1", "0b9c6f7e-3d1a-4c55-9a0e-6f1d2b3c4d5e", "", "ünïcödé"]) {
      expect(visitorName(id)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    }
  })

  it("spreads different IDs across both word lists", () => {
    const names = Array.from({ length: 500 }, (_, i) => visitorName(`device-${i}`))
    const adjectives = new Set(names.map((n) => n.split(" ")[0]))
    const animals = new Set(names.map((n) => n.split(" ")[1]))
    expect(adjectives.size).toBeGreaterThan(30)
    expect(animals.size).toBeGreaterThan(30)
    expect(new Set(names).size).toBeGreaterThan(400)
  })

  it("does not tie the animal to the adjective", () => {
    const quiet = Array.from({ length: 3000 }, (_, i) => visitorName(`v${i}`)).filter((n) => n.startsWith("Quiet "))
    expect(new Set(quiet).size).toBeGreaterThan(5)
  })
})
