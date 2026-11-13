import { expect, it } from "vitest"
import { buildScript, MAX_GZIP_BYTES } from "../build.ts"

it("the built browser script stays under 2 KB gzipped", async () => {
  const { gzipBytes } = await buildScript()
  expect(MAX_GZIP_BYTES).toBe(2048)
  expect(gzipBytes).toBeLessThanOrEqual(MAX_GZIP_BYTES)
})
