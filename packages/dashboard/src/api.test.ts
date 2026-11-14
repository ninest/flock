// @vitest-environment happy-dom
import { MemberId } from "@flock/shared"
import { describe, expect, it } from "vitest"
import { request, RequestError } from "./api.ts"
import { json, stubApi } from "./test-support.tsx"

const api = stubApi()

describe("request", () => {
  it("turns a refused removal of a Project's only owner into its message", async () => {
    const message = "This Member is the only owner of \"Blog\". Make another Member an owner of each of those Projects first."
    api.respond = () => json(409, { _tag: "SoleProjectOwner", message, projects: ["prj_1"] })
    const failure = await request((api) => api.instance.removeMember({ params: { memberId: MemberId.make("mem_1") } }))
      .catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(RequestError)
    expect((failure as RequestError).message).toBe(message)
  })
})
