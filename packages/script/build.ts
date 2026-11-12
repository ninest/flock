// Builds the browser script into one minified IIFE. Served by the Flock server at /flock.js.
//   node build.ts           writes dist/flock.js
//   node build.ts --watch   rebuilds on change
import { build, context, type BuildOptions } from "esbuild"
import { gzipSync } from "node:zlib"
import { fileURLToPath } from "node:url"

/** The script must stay under this size, gzipped. */
export const MAX_GZIP_BYTES = 2048

const options: BuildOptions = {
  entryPoints: [fileURLToPath(new URL("./src/script.ts", import.meta.url))],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "none"
}

export const outfile = fileURLToPath(new URL("./dist/flock.js", import.meta.url))

/** Builds the script in memory and reports its gzipped size. */
export const buildScript = async (): Promise<{ readonly code: string; readonly gzipBytes: number }> => {
  const result = await build({ ...options, write: false })
  const code = result.outputFiles![0]!.text
  return { code, gzipBytes: gzipSync(code, { level: 9 }).length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--watch")) {
    const ctx = await context({ ...options, outfile, logLevel: "info" })
    await ctx.watch()
  } else {
    const { code, gzipBytes } = await buildScript()
    await build({ ...options, outfile })
    console.log(`dist/flock.js: ${code.length} B, ${gzipBytes} B gzipped (limit ${MAX_GZIP_BYTES} B)`)
    if (gzipBytes > MAX_GZIP_BYTES) {
      console.error("The browser script exceeds 2 KB gzipped.")
      process.exit(1)
    }
  }
}
