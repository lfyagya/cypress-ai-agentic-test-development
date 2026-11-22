// gsdErrors: the I8 runtime check. A fake install (VERSION + a placeholder gsd-tools) and a stubbed
// gsd-tools answer stand in for GSD Core, so this runs offline; install-gsd.mjs itself calls the real one.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GSD_WORKFLOW, gatePoints } from "../../harness/workflow-model.mjs";
import { enabledRuntimes, gsdErrors } from "./install-gsd.mjs";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = mkdtempSync(join(tmpdir(), "harness-install-gsd-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

const id = GSD_WORKFLOW.gsd.capability;
cpSync(
  join(SRC, "harness", "capability"),
  join(root, "harness", "capability"),
  { recursive: true },
);
const shippedVersion = JSON.parse(
  (await import("node:fs")).readFileSync(
    join(root, "harness", "capability", id, "capability.json"),
    "utf8",
  ),
).version;
writeFileSync(
  join(root, "harness.config.json"),
  JSON.stringify({
    adapters: {
      copilot: { enabled: false },
      claude: { enabled: true },
      cursor: { enabled: true },
    },
  }),
);
assert.deepEqual(
  enabledRuntimes({
    adapters: { claude: { enabled: true }, copilot: { enabled: false } },
  }),
  ["claude"],
);

assert.match(gsdErrors(root).join(), /GSD Core is not installed/);

const gsdCore = join(root, ".cursor", "gsd-core");
mkdirSync(join(gsdCore, "bin"), { recursive: true });
writeFileSync(join(gsdCore, "bin", "gsd-tools.cjs"), "// placeholder\n");
writeFileSync(join(gsdCore, "VERSION"), `${GSD_WORKFLOW.gsd.version}\n`);

// A stub that answers like GSD with the capability active and every gate rendered at its point.
const rendered = (point) =>
  gatePoints()
    .filter((g) => g.point === point)
    .map(
      (g) => `node scripts/gates.mjs check --phase-dir "/p" --need ${g.gate}`,
    )
    .join("\n");
const stub =
  (over = {}) =>
  (args) => {
    if (args[0] === "capability")
      return JSON.stringify(
        over.list ?? [{ id, status: "active", version: shippedVersion }],
      );
    if (args[0] === "loop") return (over.render ?? rendered)(args[2]);
    throw new Error(`unexpected ${args.join(" ")}`);
  };

assert.deepEqual(
  gsdErrors(root, { run: stub() }),
  [],
  "found under the second enabled runtime",
);
assert.match(
  gsdErrors(root, { run: stub({ list: [] }) }).join(),
  new RegExp(`${id} capability is not installed`),
);
assert.match(
  gsdErrors(root, {
    run: stub({ list: [{ id, status: "disabled", reason: "no consent" }] }),
  }).join(),
  /is disabled \(no consent\); inactive means every gate is off/,
);
assert.match(
  gsdErrors(root, {
    run: stub({ list: [{ id, status: "active", version: "0.0.1" }] }),
  }).join(),
  /is at 0\.0\.1, the engine ships/,
);
// The manifest saying so is not enough: a gate GSD would not actually run is a gap.
assert.deepEqual(
  gsdErrors(root, {
    run: stub({ render: (p) => rendered(p).replace(/--need G3/, "--need G9") }),
  }),
  ["GSD does not check G3 at plan:post"],
);
writeFileSync(join(gsdCore, "VERSION"), "0.9.0\n");
assert.match(
  gsdErrors(root, { run: stub() }).join(),
  /GSD Core 0\.9\.0 is installed; the harness pins/,
);

console.log(
  "[install-gsd:test] pin, capability state and rendered gates verified",
);
