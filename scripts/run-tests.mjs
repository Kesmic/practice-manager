/**
 * Runs the test suite.
 *
 * Node cannot execute TypeScript on its own at the version CI pins, and this project
 * already carries esbuild to bundle the Worker, so the tests are bundled the same way
 * and handed to Node's built-in runner. That keeps the dependency list where it is: a
 * test framework would be a larger addition than the tests themselves.
 *
 * Each file under `tests/` becomes one bundle, so a failure names the file it came from.
 * The output directory is disposable and is rebuilt on every run.
 */

import { build } from "esbuild";
import { spawn } from "node:child_process";
import { readdirSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outdir = `${root}.test-build`;

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const entryPoints = readdirSync(`${root}tests`)
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `${root}tests/${name}`);

if (entryPoints.length === 0) {
  console.error("No test files found under tests/.");
  process.exit(1);
}

await build({
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outExtension: { ".js": ".mjs" },
  // Node's own modules are resolved at run time, not bundled in.
  external: ["node:*"],
  logLevel: "warning",
});

// The built files are named explicitly rather than passed as a directory: Node's runner
// resolves a bare directory argument as a module, not as a place to look for tests.
const built = readdirSync(outdir).map((name) => `${outdir}/${name}`);

const child = spawn(process.execPath, ["--test", ...built], { stdio: "inherit" });
child.on("exit", (code) => {
  rmSync(outdir, { recursive: true, force: true });
  process.exit(code ?? 1);
});
