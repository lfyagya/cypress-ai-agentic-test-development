#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CONFIGURE_RE,
  evaluateConfigReady,
  lockProjectProfile,
} from "./config-ready.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK = join(ROOT, ".claude", "hooks", "harness-config-gate.mjs");
const LIVE = join(ROOT, "harness.config.json");

function hook(dir, prompt) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CURSOR_PROJECT_DIR: dir },
    timeout: 10000,
  });
  return {
    code: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "harness-ready-"));
  mkdirSync(join(dir, "harness", "profiles", "projects"), { recursive: true });
  return dir;
}

function writeProfile(dir, profile, filename = `${profile.key}.json`) {
  writeFileSync(
    join(dir, "harness", "profiles", "projects", filename),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
}

const live = JSON.parse(readFileSync(LIVE, "utf8"));
// Fixture profiles are synthetic, but the adapter has to be one this clone really has, so it
// is read from the live config rather than hardcoded to one framework.
const ADAPTER = live.framework;

const completeProfile = {
  key: "payments",
  displayName: "Payments",
  owner: "QA Guild",
  adapter: ADAPTER,
  projectName: "payments-web",
  repo: "https://github.com/acme/payments",
  adapters: { claude: { enabled: true } },
  pattern: "command-first",
  paths: {
    testRoot: "tests",
    configRoot: "config",
    commandRoot: "support/commands",
    specGlob: "tests/**/*.spec.js",
  },
  wiring: {
    packageManager: "npm",
    workspacePackage: false,
    verifyScript: "npm run verify",
  },
  strategy: {
    auth: "cached-session",
    testData: "fresh",
    credentialSource: "ci-secret",
  },
};

const readyDir = tmp();
writeFileSync(
  join(readyDir, "harness.config.json"),
  `${JSON.stringify(live, null, 2)}\n`,
);
writeProfile(readyDir, {
  ...completeProfile,
  projectName: live.project.name,
  locked: true,
});

assert.equal(
  evaluateConfigReady(readyDir).status,
  "ready",
  "locked matching profile is ready",
);
assert.equal(
  hook(readyDir, "write a login smoke test").code,
  0,
  "ready: work prompt allowed",
);

const missing = tmp();
assert.equal(evaluateConfigReady(missing).status, "missing");
assert.equal(
  hook(missing, "write a login smoke test").code,
  2,
  "missing: work blocked",
);

const broken = tmp();
writeFileSync(join(broken, "harness.config.json"), "{ not json", "utf8");
assert.equal(evaluateConfigReady(broken).status, "broken");
assert.equal(
  hook(broken, "write a smoke test").code,
  2,
  "broken JSON: work blocked",
);

const unlocked = tmp();
writeFileSync(
  join(unlocked, "harness.config.json"),
  `${JSON.stringify(live, null, 2)}\n`,
);
writeProfile(unlocked, {
  ...completeProfile,
  projectName: live.project.name,
  locked: false,
});
assert.equal(evaluateConfigReady(unlocked).status, "unlocked");
assert.equal(
  hook(unlocked, "write a login smoke test").code,
  2,
  "unlocked: work blocked",
);
assert.equal(
  hook(unlocked, "npm run harness:lock").code,
  0,
  "unlocked: lock prompt allowed",
);
assert.equal(
  lockProjectProfile(unlocked).ok,
  true,
  "lock signs off a complete profile",
);
assert.equal(evaluateConfigReady(unlocked).status, "ready");
assert.equal(
  hook(unlocked, "write a login smoke test").code,
  0,
  "after lock: work allowed",
);

const template = tmp();
writeFileSync(
  join(template, "harness.config.json"),
  `${JSON.stringify(live, null, 2)}\n`,
);
writeProfile(
  template,
  {
    key: "<short-kebab-key>",
    displayName: "<Project Name>",
    owner: "<a person, not a team — replace before compose>",
    adapter: ADAPTER,
    projectName: live.project.name,
    repo: "<path or URL of the repo this composes into>",
    adapters: { claude: { enabled: true } },
    locked: false,
  },
  "unfilled.json",
);
assert.equal(evaluateConfigReady(template).status, "unconfigured");
assert.equal(
  lockProjectProfile(template).ok,
  false,
  "lock refuses a template profile",
);
assert.equal(hook(template, "add a checkout spec").code, 2);
assert.equal(
  hook(template, `Configure the ${ADAPTER} harness for this project`).code,
  0,
);
// And with no framework name at all, since the phrase is optional in CONFIGURE_RE.
assert.equal(hook(template, "Configure the harness for this project").code, 0);

assert.equal(
  CONFIGURE_RE.test(
    "write a login smoke test and use the module from harness.config.json",
  ),
  false,
  "work prompt mentioning harness.config.json is not configure",
);
assert.equal(
  hook(
    template,
    "write a login smoke test and use the module from harness.config.json",
  ).code,
  2,
);

const here = evaluateConfigReady(ROOT);
assert.equal(
  here.status,
  "ready",
  "this clone must be complete and locked before push",
);

console.log("test-config-ready: all use cases passed");
