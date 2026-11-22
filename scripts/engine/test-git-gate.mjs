// The git gate through real `git commit` / `git push`, in a throwaway multi-repo workspace laid out the
// way a consumer vendors it: <ws>/scripts/engine/git-gate.mjs, <ws>/harness/githooks/*, lane clones
// one level below with core.hooksPath pointing at the workspace hooks. Asserts exit status, not wording.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "harness-git-gate-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const tryGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

function workspace({ withGate = true } = {}) {
  const ws = mkdtempSync(join(tmp, "ws-"));
  mkdirSync(join(ws, "scripts", "engine"), { recursive: true });
  if (withGate)
    copyFileSync(
      join(SRC, "scripts", "engine", "git-gate.mjs"),
      join(ws, "scripts", "engine", "git-gate.mjs"),
    );
  cpSync(join(SRC, "harness", "githooks"), join(ws, "harness", "githooks"), {
    recursive: true,
  });
  writeFileSync(
    join(ws, "harness.config.json"),
    JSON.stringify({
      workspace: {
        repos: {
          lane: { branch: "gsd/dev", access: "write" },
          product: { branch: "main", access: "read" },
        },
      },
      git: {
        protectedBranches: ["main", "dev", "gsd/(?:dev|staging)"],
        secretFiles: [".env", ".env.*", "cypress.env.json"],
        blockedPaths: ["/cypress/(?:screenshots|videos)/"],
      },
    }),
  );
  return ws;
}

function clone(ws, name, branch) {
  const dir = join(ws, name);
  mkdirSync(dir);
  git(["init", "-q", "-b", branch], dir);
  git(["config", "user.email", "gate@test"], dir);
  git(["config", "user.name", "gate"], dir);
  git(
    [
      "config",
      "core.hooksPath",
      join(ws, "harness", "githooks").replace(/\\/g, "/"),
    ],
    dir,
  );
  return dir;
}

const commit = (dir, file, content = "x") => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
  git(["add", "--", file], dir);
  return tryGit(["commit", "-q", "-m", `add ${file}`], dir);
};

const ws = workspace();
const lane = clone(ws, "lane", "gsd/dev");

// A lane's hook resolves the WORKSPACE gate. (A shim that looked inside the lane would find nothing.)
assert.notEqual(
  commit(lane, "seed.txt").status,
  0,
  "commit on a protected lane base is blocked",
);
git(["switch", "-q", "-c", "feat/x-e2e"], lane);
assert.equal(
  commit(lane, "seed.txt").status,
  0,
  "feature-branch commit is allowed",
);
assert.notEqual(commit(lane, ".env.local").status, 0, ".env.* is a secret");
git(["reset", "-q"], lane);
assert.notEqual(
  commit(lane, "cfg/cypress.env.json").status,
  0,
  "profile secret file",
);
git(["reset", "-q"], lane);
assert.notEqual(
  commit(lane, "cypress/videos/run.mp4").status,
  0,
  "profile blocked path",
);
git(["reset", "-q"], lane);

const product = clone(ws, "product", "feature");
assert.notEqual(
  commit(product, "fix.txt").status,
  0,
  "a read-only repo never takes a commit",
);

// Push through a real remote: a new branch passes, a rewrite of what was pushed is proven and blocked.
const remote = join(tmp, "remote.git");
git(["init", "-q", "--bare", remote], tmp);
git(["remote", "add", "origin", remote], lane);
assert.equal(
  tryGit(["push", "-q", "origin", "feat/x-e2e"], lane).status,
  0,
  "feature push allowed",
);
assert.notEqual(
  tryGit(["push", "-q", "origin", "feat/x-e2e:gsd/dev"], lane).status,
  0,
  "push onto a protected branch",
);
assert.notEqual(
  tryGit(["push", "-q", "origin", "feat/x-e2e:other"], lane).status,
  0,
  "refspec rename",
);
git(["tag", "v1"], lane);
assert.notEqual(
  tryGit(["push", "-q", "origin", "v1"], lane).status,
  0,
  "tag push",
);
writeFileSync(join(lane, "seed.txt"), "amended");
git(["commit", "-q", "-a", "--amend", "-m", "rewrite"], lane);
assert.notEqual(
  tryGit(["push", "-q", "-f", "origin", "feat/x-e2e"], lane).status,
  0,
  "provable force push",
);
assert.notEqual(
  tryGit(["push", "-q", "origin", ":feat/x-e2e"], lane).status,
  0,
  "branch delete",
);

// A hook path set on purpose with no gate behind it blocks instead of allowing everything.
const bare = workspace({ withGate: false });
const orphan = clone(bare, "lane", "gsd/dev");
git(["switch", "-q", "-c", "feat/y"], orphan);
const r = commit(orphan, "a.txt");
assert.notEqual(r.status, 0, "missing gate blocks");
assert.match(r.stderr, /missing; blocked/);

// Single-repo consumer (no workspace block): engine defaults protect main and .env.
const single = mkdtempSync(join(tmp, "single-"));
mkdirSync(join(single, "scripts", "engine"), { recursive: true });
copyFileSync(
  join(SRC, "scripts", "engine", "git-gate.mjs"),
  join(single, "scripts", "engine", "git-gate.mjs"),
);
cpSync(join(SRC, "harness", "githooks"), join(single, "harness", "githooks"), {
  recursive: true,
});
writeFileSync(join(single, "harness.config.json"), "{}");
git(["init", "-q", "-b", "main"], single);
git(["config", "user.email", "gate@test"], single);
git(["config", "user.name", "gate"], single);
git(["config", "core.hooksPath", "harness/githooks"], single);
assert.notEqual(
  commit(single, "a.txt").status,
  0,
  "default: main is protected",
);
git(["switch", "-q", "-c", "feat/z"], single);
assert.equal(commit(single, "a.txt").status, 0);
assert.notEqual(commit(single, ".env").status, 0, "default: .env is a secret");

console.log(
  "[git-gate:test] commit, push, force, delete, read-only, secret, blocked-path and missing-gate cases verified",
);
