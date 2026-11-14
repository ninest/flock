// @vitest-environment happy-dom
import { MemberId } from "@flock/shared"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { request, RequestError } from "./api.ts"

// The API is stubbed at fetch. Effect keeps the fetch it first sees, so one stub serves every test.
let respond: () => Promise<Response> = () => new Promise(() => {})
beforeAll(() => {
  vi.stubGlobal("fetch", () => respond())
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("request", () => {
  it("turns a refused removal of a Project's only owner into its message", async () => {
    const message = "This Member is the only owner of \"Blog\". Make another Member an owner of each of those Projects first."
    respond = json(409, { _tag: "SoleProjectOwner", message, projects: ["prj_1"] })
    const failure = await request((api) => api.instance.removeMember({ params: { memberId: MemberId.make("mem_1") } }))
      .catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(RequestError)
    expect((failure as RequestError).message).toBe(message)
  })
})
