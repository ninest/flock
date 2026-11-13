// The landing page at https://flock.misc.page: static assets, plus a Worker that answers byte ranges for the hero video.
// `pnpm landing:deploy` copies site/ and public/ into dist/ (see wrangler.config.ts), then runs `cf deploy`.
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "flock-landing",
    compatibilityDate: "2026-11-01",
    entrypoint: "./worker/index.ts",
    env: { ASSETS: bindings.assets() },
    assets: { runWorkerFirst: ["/drive.mp4"] },
    domains: ["flock.misc.page"],
    workersDev: false,
  },
});
