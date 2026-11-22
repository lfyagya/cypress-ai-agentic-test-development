#!/usr/bin/env node
// Tool-agnostic git gate: `commit`, `push <remote>`, `pr <remote>`, called by harness/githooks/*.
//
// Why a git hook as well as the write-time hooks: git, not the agent, fires it, so Claude, Cursor,
// Codex, Copilot, Gemini and a human are gated identically, including the tools that have no
// PreToolUse hook (I2's advisory-only adapters). It is the backstop under the write-time rules.
//
// Policy comes from harness.config.json at the project root (two levels above this script), composed
// from the profile:
//   workspace.repos  { <folder>: { branch, access: "write" | "read" } }  multi-repo workspaces only
//   git.protectedBranches  regex sources, whole branch name     default: main, master, dev, develop,
//                                                                 staging, prod, production, release*
//   git.secretFiles        file names; "x.*" matches x.<anything>  default: .env, .env.*
//   git.blockedPaths       regex sources tested against "/<path>"   default: none
// HARNESS_CONFIG overrides the file (tests use it).
//
// Exit status is 0 (allow) or 1 (block, one reason line on stderr). It never prints file content, only
// the rule and the path that tripped it. Every internal error blocks: a gate that cannot evaluate must
// not silently allow.
//
// Known limit: git does not pass push options to pre-push, so `--force` is caught by proof (the remote
// tip is present locally and is not an ancestor of the local tip), not by matching the flag.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const block = (reason) => {
  process.stderr.write(`git-gate: ${reason}\n`);
  process.exit(1);
};
const fail = (e) =>
  block(
    `gate error: ${String(e?.message ?? e)
      .split(/\r?\n/)[0]
      .slice(0, 120)}; blocked`,
  );
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

export const DEFAULT_PROTECTED = [
  "main",
  "master",
  "dev",
  "develop",
  "staging",
  "prod",
  "production",
  "release[\\w./-]*",
];
export const DEFAULT_SECRET_FILES = [".env", ".env.*"];

const configFile =
  process.env.HARNESS_CONFIG ??
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "harness.config.json",
  );
let config;
try {
  config = JSON.parse(readFileSync(configFile, "utf8"));
} catch {
  block(`no readable harness.config.json at ${configFile}; blocked`);
}
const repos = config.workspace?.repos ?? {};
const readOnly = new Set(
  Object.keys(repos).filter((name) => repos[name].access === "read"),
);
const baseBranch = new Map(
  Object.entries(repos).map(([name, repo]) => [name, repo.branch]),
);
const PROTECTED = new RegExp(
  `^(?:${(config.git?.protectedBranches ?? DEFAULT_PROTECTED).join("|")})$`,
);
const isProtected = (ref) =>
  PROTECTED.test(String(ref).replace(/^refs\/heads\//, ""));
const secretFiles = config.git?.secretFiles ?? DEFAULT_SECRET_FILES;
const isSecret = (name) =>
  secretFiles.some((s) =>
    s.endsWith(".*") ? name.startsWith(s.slice(0, -1)) : name === s,
  );
const blockedPaths = (config.git?.blockedPaths ?? []).map((s) => new RegExp(s));

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 20000 });
  return r.status === 0 ? String(r.stdout).replace(/\r?\n$/, "") : "";
}
const root = git(["rev-parse", "--show-toplevel"], process.cwd()).replace(
  /\\/g,
  "/",
);
if (!root) block("not a git repository; blocked");
const repoName = root.split("/").pop();
// symbolic-ref, not rev-parse --abbrev-ref: it also names an unborn branch, so the first commit is gated too.
const currentBranch = () =>
  git(["symbolic-ref", "--short", "-q", "HEAD"], root) || "HEAD";
// A managed clone is one the workspace lists, so it sits one level under the workspace root.
const managed = baseBranch.has(repoName);
const inWorkspaceRoot = !managed;

function deniedPath(rel) {
  const p = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = p.split("/");
  // Only from the workspace root is a staged path `<repo>/<path>`; inside a clone the first segment is
  // that clone's own folder.
  if (inWorkspaceRoot && readOnly.has(parts[0]))
    return `${parts[0]} is read-only; record findings in the workspace docs instead: ${p}`;
  const name = parts[parts.length - 1];
  if (isSecret(name))
    return `committing ${name} would publish a secret; keep it in untracked local config: ${p}`;
  if (blockedPaths.some((re) => re.test(`/${p}`)))
    return `${p} is a blocked path (git.blockedPaths in the profile) and must not be committed`;
  return "";
}

function preCommit() {
  const branch = currentBranch();
  const staged = git(["diff", "--cached", "--name-only"], root)
    .split("\n")
    .filter(Boolean);
  if (!staged.length) return;
  if (readOnly.has(repoName))
    block(
      `${repoName} is a read-only repo; record findings in the workspace docs, never commit here`,
    );
  for (const f of staged) {
    const why = deniedPath(f);
    if (why) block(why);
  }
  if (isProtected(branch))
    block(
      `committing directly on ${branch} is blocked; work on a feature branch and open a PR`,
    );
  runRules(["--staged"]);
}

// ---- The same rules and standard for every committer --------------------------------------------
// The lane's rule check (scripts/engine/check-rules.mjs, beside this gate) runs on what is committed
// and pushed, and the project's own verify command (lint, type-check, tests) runs before a push. Git
// fires this for every tool and every human; `--no-verify` skips it locally but CI runs the same check.
const projectRoot = dirname(configFile);
const checker = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-rules.mjs",
);
const hasRules = Array.isArray(config.rules) && config.rules.length > 0;

function runRules(args) {
  if (!hasRules) return; // nothing composed to enforce
  if (!existsSync(checker))
    block(
      `${checker} is missing beside the git gate; blocked (re-vendor the harness)`,
    );
  const r = spawnSync(process.execPath, [checker, ...args, "--repo", root], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (r.status !== 0)
    block(
      "the rule check failed (above). Each finding names its fix and its unblock path; fix them and retry",
    );
}

// The commits a push adds: from the remote tip, or for a new branch from where it left its base.
function pushedRange(localSha, remoteSha) {
  if (remoteSha && !/^0+$/.test(remoteSha))
    return ["--range", `${remoteSha}..${localSha}`];
  const base =
    baseBranch.get(repoName) ??
    git(
      ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
      root,
    ).replace(/^origin\//, "");
  const fork = base && git(["merge-base", localSha, `origin/${base}`], root);
  return fork ? ["--range", `${fork}..${localSha}`] : ["--all"];
}

function runVerify() {
  const script = config.wiring?.verifyScript;
  if (!script) return;
  // In a workspace the composed config describes one lane; other clones run their own standard.
  if (Object.keys(repos).length && repoName !== config.project?.repo) return;
  const r = spawnSync(script, { cwd: root, shell: true, stdio: "inherit" });
  if (r.status !== 0)
    block(
      `the project's verify command failed: ${script}. Fix it before pushing`,
    );
}

// git passes <remote> <url>, then one '<local ref> <local sha> <remote ref> <remote sha>' line per ref on stdin.
function prePush(remote) {
  if (!remote) block("push has no explicit remote; blocked");
  let input;
  try {
    input = readFileSync(0, "utf8");
  } catch {
    input = "";
  }
  const lines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) block("push lists no ref; blocked");
  for (const line of lines) {
    const [localRef, localSha = "", remoteRef, remoteSha = ""] =
      line.split(/\s+/);
    const local = String(localRef).replace(/^refs\/heads\//, "");
    const remoteName = String(remoteRef).replace(/^refs\/heads\//, "");
    if (/^refs\/tags\//.test(String(localRef)))
      block("pushing a tag is blocked; a human tags releases");
    if (/^0+$/.test(localSha)) block(`deleting ${remoteName} is blocked`);
    if (local === "HEAD" || local === "@")
      block("name the branch explicitly instead of HEAD; blocked");
    if (isProtected(local))
      block(
        `pushing ${local} is blocked; push a feature branch and open a PR instead`,
      );
    if (isProtected(remoteName))
      block(
        `updating ${remoteName} is blocked; open a PR so the owner reviews it`,
      );
    if (remoteName !== local)
      block(
        `rewriting ${local} to ${remoteName} is blocked; push the branch under its own name`,
      );
    if (remoteSha && !/^0+$/.test(remoteSha) && localSha !== remoteSha) {
      if (
        spawnSync("git", ["cat-file", "-e", `${remoteSha}^{commit}`], {
          cwd: root,
        }).status === 0
      ) {
        if (
          spawnSync(
            "git",
            ["merge-base", "--is-ancestor", remoteSha, localSha],
            { cwd: root },
          ).status !== 0
        )
          block(
            `pushing ${local} rewrites published history (a force push); blocked - push a new branch instead`,
          );
      } else {
        process.stderr.write(
          `git-gate: note: the remote tip of ${local} is not fetched locally, so a force push cannot be detected here\n`,
        );
      }
    }
    runRules(pushedRange(localSha, remoteSha));
  }
  const branch = currentBranch();
  if (isProtected(branch))
    block(
      `pushing from ${branch} is blocked; push a feature branch and open a PR instead`,
    );
  runVerify();
}

// Opens the draft PR for a freshly pushed feature branch of a managed clone. Never merges. Best effort:
// the push already happened, so a failure here prints a hint and exits 0.
function postPush() {
  const branch = currentBranch();
  if (!managed || !branch || branch === "HEAD" || isProtected(branch)) return;
  if (
    spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 15000 })
      .status !== 0
  ) {
    process.stderr.write(
      "git-gate: gh not found; create the PR manually: gh pr create --draft\n",
    );
    return;
  }
  const existing = spawnSync(
    "gh",
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number"],
    { cwd: root, encoding: "utf8", timeout: 30000 },
  );
  let open;
  try {
    open = existing.status === 0 ? JSON.parse(existing.stdout || "[]") : [];
  } catch {
    open = [];
  }
  if (open.length) {
    process.stderr.write(
      `git-gate: PR #${open[0].number} already open for ${branch}\n`,
    );
    return;
  }
  const base = baseBranch.get(repoName);
  const title = git(["log", "-1", "--pretty=%s"], root);
  const r = spawnSync(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--base",
      base,
      "--head",
      branch,
      "--title",
      title || branch,
      "--body",
      `Draft PR opened by the harness git gate for \`${branch}\`.\n\nBase: \`${base}\`. The owner approves the merge.`,
    ],
    { cwd: root, stdio: "inherit", timeout: 60000 },
  );
  if (r.status !== 0)
    process.stderr.write(
      "git-gate: draft PR not opened; create it manually: gh pr create --draft\n",
    );
}

const sub = process.argv[2];
if (sub === "commit") preCommit();
else if (sub === "push") prePush(process.argv[3]);
else if (sub === "pr") postPush();
else
  block(`unknown subcommand ${sub ?? "(none)"}; expected commit, push or pr`);
process.exit(0);
