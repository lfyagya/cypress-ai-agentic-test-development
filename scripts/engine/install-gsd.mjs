#!/usr/bin/env node
// Installs the pinned GSD Core and the qa-harness capability, so GSD actually runs the pipeline and
// blocks it at G0-G5 instead of the harness only describing them.
//   node scripts/engine/install-gsd.mjs            install what is missing or at the wrong version
//   node scripts/engine/install-gsd.mjs --check    report only; exit 1 on any gap (conformance I8 uses gsdErrors)
//   --root <dir>  the project root (default: two levels above this script)
//
// Runtimes follow the profile: each enabled adapter (claude, cursor, codex, copilot) gets GSD's
// --<adapter> flag, installed --local into the project. The capability is per user (GSD records consent
// per machine), so every person runs this once; --check tells them when they have not.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GSD_WORKFLOW, gatePoints } from "../../harness/workflow-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIRS = {
  claude: ".claude",
  cursor: ".cursor",
  codex: ".codex",
  copilot: ".github",
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const firstLine = (e) =>
  String(e?.stderr || e?.message || e)
    .split(/\r?\n/)[0]
    .slice(0, 160);

export function enabledRuntimes(config) {
  return Object.entries(config.adapters ?? {})
    .filter(([name, adapter]) => adapter?.enabled && RUNTIME_DIRS[name])
    .map(([name]) => name);
}

/** gsd-tools.cjs of the local install: under the first enabled runtime that has one. */
export function gsdToolsPath(root, runtimes = Object.keys(RUNTIME_DIRS)) {
  return runtimes
    .map((r) => join(root, RUNTIME_DIRS[r], "gsd-core", "bin", "gsd-tools.cjs"))
    .find((p) => existsSync(p));
}

export const capabilityDir = (root) =>
  join(root, "harness", "capability", GSD_WORKFLOW.gsd.capability);

/** Every way GSD would not enforce the gates right now; [] when it would. */
export function gsdErrors(root, { workflow = GSD_WORKFLOW, run } = {}) {
  const config = readJson(join(root, "harness.config.json"));
  const runtimes = enabledRuntimes(config);
  if (!runtimes.length)
    return ["no enabled adapter that GSD Core installs for"];
  const tools = gsdToolsPath(root, runtimes);
  if (!tools) return [`GSD Core is not installed`];
  const errors = [];
  const version = readFileSync(
    join(dirname(dirname(tools)), "VERSION"),
    "utf8",
  ).trim();
  if (version !== workflow.gsd.version)
    errors.push(
      `GSD Core ${version} is installed; the harness pins ${workflow.gsd.version}`,
    );
  const gsd =
    run ??
    ((args) =>
      execFileSync(process.execPath, [tools, ...args, "--cwd", root], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
  const want = readJson(join(capabilityDir(root), "capability.json")).version;
  const id = workflow.gsd.capability;
  try {
    const mine = JSON.parse(gsd(["capability", "list", "--json"])).find(
      (c) => c.id === id,
    );
    if (!mine) errors.push(`${id} capability is not installed for this user`);
    else {
      if (mine.status !== "active")
        errors.push(
          `${id} capability is ${mine.status} (${mine.reason ?? "no reason given"}); inactive means every gate is off`,
        );
      if (mine.version !== want)
        errors.push(
          `${id} capability is at ${mine.version}, the engine ships ${want}`,
        );
    }
  } catch (e) {
    errors.push(`capability list failed: ${firstLine(e)}`);
  }
  // What GSD will actually run at each loop point, not what the manifest claims.
  for (const point of [...new Set(gatePoints(workflow).map((g) => g.point))]) {
    const gates = gatePoints(workflow)
      .filter((g) => g.point === point)
      .map((g) => g.gate);
    try {
      const out = gsd(["loop", "render-hooks", point, "--raw"]);
      for (const gate of gates)
        if (!new RegExp(`gates\\.mjs check .*--need ${gate}\\b`).test(out))
          errors.push(`GSD does not check ${gate} at ${point}`);
    } catch (e) {
      errors.push(`loop render-hooks ${point} failed: ${firstLine(e)}`);
    }
  }
  return errors;
}

function main(args) {
  const at = args.indexOf("--root");
  const root = resolve(at >= 0 ? args[at + 1] : join(here, "..", ".."));
  const check = args.includes("--check");
  const { package: pkg, version, capability } = GSD_WORKFLOW.gsd;
  if (!check) {
    const runtimes = enabledRuntimes(
      readJson(join(root, "harness.config.json")),
    );
    const tools = gsdToolsPath(root, runtimes);
    const installed = tools
      ? readFileSync(join(dirname(dirname(tools)), "VERSION"), "utf8").trim()
      : null;
    if (installed !== version) {
      console.log(
        `[gsd] installing ${pkg}@${version} for ${runtimes.join(", ")}`,
      );
      // One command string through the shell (npx is npx.cmd on Windows). Every word is a fixed flag
      // or the pinned package, never user input, so nothing needs escaping.
      const command = [
        "npx",
        "--yes",
        `${pkg}@${version}`,
        ...runtimes.map((r) => `--${r}`),
        "--local",
      ].join(" ");
      const r = spawnSync(command, {
        cwd: root,
        stdio: "inherit",
        shell: true,
      });
      if (r.status !== 0) {
        console.error(
          "[gsd] install failed; check network/npm access and re-run",
        );
        process.exit(1);
      }
      // GSD's installers edit instruction files the harness owns (Copilot's
      // copilot-instructions.md among them). Re-project them so a first install
      // never leaves the repo drifted from harness.config.json.
      execFileSync(
        process.execPath,
        [join(root, "scripts", "engine", "sync.mjs")],
        {
          cwd: root,
          stdio: "inherit",
        },
      );
    }
    const errors = gsdErrors(root);
    if (errors.some((e) => e.includes("capability"))) {
      console.log(
        `[gsd] installing the ${capability} capability for this user`,
      );
      execFileSync(
        process.execPath,
        [
          gsdToolsPath(root, runtimes),
          "capability",
          "install",
          capabilityDir(root),
          "--scope",
          "project",
          "--cwd",
          root,
        ],
        { cwd: root, stdio: "inherit" },
      );
    }
  }
  const errors = gsdErrors(root);
  for (const e of errors) console.error(`[gsd] GAP ${e}`);
  if (errors.length) process.exit(1);
  console.log(
    `[gsd] GSD Core ${version} with ${capability}: every gate G0-G5 is enforced`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
