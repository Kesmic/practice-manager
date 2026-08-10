/**
 * Bundles the Worker into `dist/_worker.js`.
 *
 * Cloudflare Pages' advanced mode hands *every* request to a single
 * `_worker.js` sitting in the build output directory, and leaves it to decide
 * what is API and what is a static file. That is exactly the shape this project
 * already had, so the Worker source is unchanged by the move - it just needs
 * bundling into one file beside the built app.
 *
 * Run after `vite build`, because Vite empties `dist/` first.
 *
 * The Worker has no runtime dependencies of its own - only relative imports and
 * `shared/` - so there is nothing here to resolve from node_modules and no need
 * to teach esbuild about path aliases.
 */

import { build } from "esbuild";

const result = await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  // Resolve the way the Workers runtime does, so that if a dependency is ever
  // added it picks the build intended for this platform rather than Node's.
  conditions: ["workerd", "worker", "browser", "import", "module", "default"],
  mainFields: ["module", "main"],
  // Left unminified deliberately: Cloudflare's logs show stack traces from this
  // file, and the whole bundle is a few tens of kilobytes either way.
  minify: false,
  sourcemap: false,
  metafile: true,
  logLevel: "warning",
});

const [output] = Object.entries(result.metafile.outputs);
console.log(`_worker.js  ${(output[1].bytes / 1024).toFixed(1)} kB`);
