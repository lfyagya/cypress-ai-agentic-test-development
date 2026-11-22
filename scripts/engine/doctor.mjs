#!/usr/bin/env node
// The harness looking at itself: explores the project, finds every gap between what the profile
// declares and what is true, connects each gap to the requirement, task, phase, test and evidence it
// belongs to, heals what is mechanical, and tells people.
//
//   node scripts/engine/doctor.mjs           report; exit 1 while any blocking gap remains
//   node scripts/engine/doctor.mjs --heal    first apply every safe repair, then report
//   node scripts/engine/doctor.mjs --ci      markdown for the CI job summary
//   node scripts/engine/doctor.mjs --json    the report object
// Always writes evidence/gaps.json; the SessionStart hook (doctor-notify.mjs) reads it.
//
// Healing is limited to repairs that cannot change policy or a human decision: regenerating drifted
// projections from the profile, pointing git at the harness hooks, installing the pinned GSD and its
// capability, installing the CI check, and dropping baseline entries whose finding is already gone
// (the baseline only shrinks). A rule violation, an open gate, an expired waiver or an uncovered
// requirement is never "healed": the gap names the fix and who decides.
//
// Every check runs in isolation. A check that cannot run is itself a blocking gap, never a pass.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASELINE_FILE } from "../../.claude/hooks/rule-engine.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const GAPS_FILE = "evidence/gaps.json";
const node = (script, args = [], opts = {}) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
const readJson = (rel, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const firstLines = (text, n = 3) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" | ");

// gap: { id, area, severity: "block" | "warn", detail, links: {...}, fix, heal? }
export async function explore({
  config = readJson("harness.config.json"),
} = {}) {
  const gaps = [];
  const add = (gap) => gaps.push(gap);
  const check = async (area, fn) => {
    try {
      await fn();
    } catch (error) {
      add({
        id: `${area}:unchecked`,
        area,
        severity: "block",
        detail: `could not check ${area}: ${firstLines(error.message, 1)}`,
        fix: "fix the error above, then re-run the doctor",
      });
    }
  };

  if (!config) {
    add({
      id: "config:missing",
      area: "config",
      severity: "block",
      detail:
        "harness.config.json is missing or unreadable, so nothing else can be assessed",
      fix: "npm run harness:compose",
    });
    return gaps;
  }
  const scripts = readJson("package.json", {})?.scripts ?? {};
  const composeAndSync = () => {
    for (const s of ["harness:compose", "harness:sync"])
      if (scripts[s])
        execFileSync("npm", ["run", s, "--silent"], {
          cwd: ROOT,
          stdio: "inherit",
          shell: process.platform === "win32",
        });
  };

  const installCi = () => {
    const dir = path.join(ROOT, ".github", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, "harness", "ci", "harness-check.yml"),
      path.join(dir, "harness.yml"),
    );
  };
  // What closes each invariant, and the ones a mechanical repair can close on its own.
  const INVARIANT = {
    I1: {
      fix: "re-compose the profile and sync: npm run harness:compose && npm run harness:sync",
      heal: composeAndSync,
    },
    I2: {
      fix: "install the CI check (harness/ci/harness-check.yml) and make it a required status check",
      heal: installCi,
    },
    I3: {
      fix: "give every block rule a pattern in .claude/hooks/<framework>.patterns.mjs, and make every declared root exist",
    },
    I4: {
      fix: "give the EVALUATE agent permissionMode plan and only Read, Grep and Glob in the adapter",
    },
    I5: {
      fix: "declare every Tier 0 concern for this team at block severity in the adapter; it cannot be overridden",
    },
    I6: {
      fix: "declare TRACE at block (or review with a reason and ratchetBy date); dev lanes need evidence/requirements.json",
    },
    I7: {
      fix: "re-vendor the engine evidence tooling and create evidence/requirements.json",
    },
    I8: {
      fix: "node scripts/engine/install-gsd.mjs (GSD Core at the pin, then the capability for this user)",
      heal: () =>
        node("scripts/engine/install-gsd.mjs", [], { stdio: "inherit" }),
    },
  };

  // 1. Conformance I1-I8: one generated policy, rules reach writer and pipeline, GSD runs the gates...
  await check("conformance", () => {
    const r = node("scripts/engine/conformance.mjs");
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s+(I\d)\s+GAP\s+(.+?)\s{2,}(.+)$/);
      if (!m) continue;
      const [, id, title, detail] = m;
      const { fix, heal } = INVARIANT[id] ?? {
        fix: "see the conformance spec for this invariant",
      };
      add({
        id: `conformance:${id}`,
        area: "conformance",
        severity: "block",
        detail: `${id} ${title}: ${detail}`,
        fix,
        heal,
      });
    }
  });

  // 2. Projections drifted from the composed config (an instruction file edited by hand, a stale agent).
  await check("drift", () => {
    if (!exists("scripts/engine/check-drift.mjs")) return;
    const r = node("scripts/engine/check-drift.mjs");
    if (r.status !== 0)
      add({
        id: "drift",
        area: "drift",
        severity: "block",
        detail: `projections differ from harness.config.json: ${firstLines(r.stdout + r.stderr)}`,
        fix: "npm run harness:sync",
        heal: composeAndSync,
      });
  });

  // 3. Git reaches every committer: hooks point at the harness gate in every writable repo.
  await check("git-hooks", () => {
    const hooks = path.join(ROOT, "harness", "githooks").replace(/\\/g, "/");
    const repos = config.workspace?.repos;
    const targets = repos
      ? Object.entries(repos)
          .filter(([, r]) => r.access === "write")
          .map(([name]) => path.join(ROOT, name))
          .filter((d) => fs.existsSync(path.join(d, ".git")))
      : [ROOT];
    for (const repo of targets) {
      const r = spawnSync("git", ["config", "core.hooksPath"], {
        cwd: repo,
        encoding: "utf8",
      });
      const current = path
        .resolve(repo, r.stdout.trim() || ".git/hooks")
        .replace(/\\/g, "/");
      if (current !== hooks) {
        const name = path.relative(ROOT, repo) || ".";
        add({
          id: `git-hooks:${name}`,
          area: "git-hooks",
          severity: "block",
          links: { repo: name },
          detail: `${name}: git hooks are not the harness gate, so commits and pushes there skip every rule`,
          fix: `git -C "${name}" config core.hooksPath "${hooks}"`,
          heal: () =>
            execFileSync("git", ["config", "core.hooksPath", hooks], {
              cwd: repo,
            }),
        });
      }
    }
  });

  // 4. CI runs the same check, so a local --no-verify gains nothing.
  await check("ci", () => {
    const dir = path.join(ROOT, ".github", "workflows");
    const wired =
      fs.existsSync(dir) &&
      fs
        .readdirSync(dir)
        .some((f) =>
          /check-rules\.mjs/.test(fs.readFileSync(path.join(dir, f), "utf8")),
        );
    if (!wired)
      add({
        id: "ci",
        area: "ci",
        severity: "block",
        detail:
          "no CI workflow runs scripts/engine/check-rules.mjs, so a bypassed hook is never caught",
        fix: "copy harness/ci/harness-check.yml to .github/workflows/harness.yml and make it a required check",
        heal: installCi,
      });
  });

  // 5. Rules: every current finding not covered by the baseline or a live waiver, and malformed waivers.
  await check("rules", () => {
    const r = node("scripts/engine/check-rules.mjs", ["--all", "--json"]);
    if (r.status === 2) throw new Error(firstLines(r.stderr));
    const { violations = [], problems = [] } = JSON.parse(r.stdout || "{}");
    for (const v of violations)
      add({
        id: `rule:${v.fingerprint}`,
        area: "rules",
        severity: "block",
        links: { file: `${v.filePath}:${v.lineNumber}`, rule: v.ruleId },
        detail: `${v.filePath}:${v.lineNumber} [${v.ruleId}] ${v.message}`,
        fix: (v.guidance ?? []).join(" · ") || "fix the finding",
      });
    for (const p of problems)
      add({
        id: `rule-record:${p.slice(0, 60)}`,
        area: "rules",
        severity: "block",
        detail: p,
        fix: "correct the waiver or baseline entry",
      });
  });

  // 6. Waivers about to lapse or lapsed: a human decides again, before CI does it for them.
  await check("waivers", () => {
    const now = Date.now();
    for (const w of readJson("evidence/rule-waivers.json", {})?.waivers ?? []) {
      const left = (Date.parse(w.expires) - now) / 86400000;
      if (left <= 7)
        add({
          id: `waiver:${w.fingerprint}`,
          area: "waivers",
          severity: left <= 0 ? "block" : "warn",
          links: { file: `${w.file}:${w.line}`, rule: w.rule, owner: w.owner },
          detail: `${w.rule} waiver at ${w.file}:${w.line} ${left <= 0 ? "expired" : `expires in ${Math.ceil(left)} day(s)`} (owner ${w.owner}: ${w.reason})`,
          fix: `fix the finding, or ${w.owner} renews: node scripts/engine/waive.mjs --rule ${w.rule} --file ${w.file} --line ${w.line} --reason "..." --owner "${w.owner}"`,
        });
    }
  });

  // 7. Baseline: legacy findings still owed, and entries whose finding is gone (safe to drop: it only shrinks).
  await check("baseline", () => {
    const baseline = readJson(BASELINE_FILE);
    if (!baseline?.entries?.length) return;
    const r = node("scripts/engine/check-rules.mjs", ["--all", "--json"], {
      env: { ...process.env, HARNESS_IGNORE_BASELINE: "1" },
    });
    if (r.status === 2) throw new Error(firstLines(r.stderr));
    const live = new Set(
      (JSON.parse(r.stdout || "{}").violations ?? []).map((v) => v.fingerprint),
    );
    const stale = baseline.entries.filter((e) => !live.has(e.fingerprint));
    const owed = baseline.entries.length - stale.length;
    if (owed)
      add({
        id: "baseline:owed",
        area: "baseline",
        severity: "warn",
        links: { owner: baseline.owner },
        detail: `${owed} legacy finding(s) still in ${BASELINE_FILE} (owner ${baseline.owner ?? "unrecorded"}); each one blocks the moment its line is touched`,
        fix: "burn them down: fix a file, then node scripts/engine/doctor.mjs --heal drops the resolved entries",
      });
    if (stale.length)
      add({
        id: "baseline:stale",
        area: "baseline",
        severity: "warn",
        detail: `${stale.length} baseline entr(ies) no longer match any finding`,
        fix: "node scripts/engine/doctor.mjs --heal",
        heal: () =>
          fs.writeFileSync(
            path.join(ROOT, BASELINE_FILE),
            `${JSON.stringify({ ...baseline, entries: baseline.entries.filter((e) => live.has(e.fingerprint)) }, null, 2)}\n`,
          ),
      });
  });

  // 8. Connect requirements to tasks, phases, tests and evidence; every broken link is a gap.
  await check("traceability", async () => {
    const registry = readJson("evidence/requirements.json");
    if (!registry) return;
    const active = (registry.requirements ?? []).filter(
      (r) => r.status === "active",
    );
    const coverage = new Map(
      (readJson("evidence/coverage-computed.json", {})?.requirements ?? []).map(
        (c) => [c.requirement, c],
      ),
    );
    const taskDir = path.join(ROOT, "evidence", "tasks");
    const tasks = fs.existsSync(taskDir)
      ? fs
          .readdirSync(taskDir)
          .filter((f) => /^[^.]+\.json$/.test(f))
          .map((f) => readJson(path.join("evidence", "tasks", f)))
          .filter(Boolean)
      : [];
    for (const req of active) {
      const c = coverage.get(req.id);
      const mine = tasks.filter((t) => t.requirements?.includes(req.id));
      const phases = [
        ...new Set(
          mine
            .map((t) =>
              (t.approvals?.G2 ?? t.approvals?.plan)?.path
                ?.split("/")
                .slice(0, 3)
                .join("/"),
            )
            .filter(Boolean),
        ),
      ];
      const links = {
        requirement: req.id,
        tasks: mine.map((t) => `${t.id}:${t.status}`),
        phases,
        tests: (c?.tests ?? []).map((t) => t.file),
      };
      if (!c || c.tests.length === 0)
        add({
          id: `trace:untested:${req.id}`,
          area: "traceability",
          severity: "warn",
          links,
          detail: `${req.id} (${req.priority ?? "no priority"}) is active with no test${mine.length ? `; task(s) ${links.tasks.join(", ")}` : " and no task"}`,
          fix: mine.length
            ? `continue the phase: node scripts/gates.mjs status --phase-dir ${phases[0] ?? "<phase>"}`
            : `node scripts/task-control.mjs new --id <id> --requirement ${req.id} --proof-mode automation-evidence`,
        });
      else if (!c.passing)
        add({
          id: `trace:failing:${req.id}`,
          area: "traceability",
          severity: "block",
          links,
          detail: `${req.id}: every test covering it fails (${links.tests.join(", ")})`,
          fix: "diagnose from the run evidence and fix the root cause (DIAGNOSE agent)",
        });
    }
    const runsDir = path.join(ROOT, "evidence", "runs");
    if (fs.existsSync(runsDir)) {
      const latest = fs.readdirSync(runsDir).sort().at(-1);
      for (const t of readJson(
        path.join("evidence", "runs", latest ?? "", "run-summary.json"),
        {},
      )?.traceabilityGaps ?? [])
        add({
          id: `trace:orphan:${t.file}:${t.title}`,
          area: "traceability",
          severity: "warn",
          links: { file: t.file },
          detail: `test "${t.title}" (${t.file}) names no requirement, so its coverage counts for nothing`,
          fix: "tag it with exactly one active requirement id",
        });
    }
  });

  // 9. Phases: where each one is waiting, and on whom.
  await check("gates", async () => {
    const phasesDir = path.join(ROOT, ".planning", "phases");
    if (!fs.existsSync(phasesDir) || !exists("scripts/gates.mjs")) return;
    const { phaseStatus } = await import(
      pathToFileURL(path.join(ROOT, "scripts", "gates.mjs"))
    );
    for (const d of fs
      .readdirSync(phasesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())) {
      const st = phaseStatus(path.join(phasesDir, d.name));
      if (st.next)
        add({
          id: `gate:${d.name}:${st.gate}`,
          area: "gates",
          severity: "warn",
          links: { phase: d.name, gate: st.gate },
          detail: `phase ${d.name} waits on ${st.gate} (${st.progress})`,
          fix: `a human, in a terminal: ${st.next}`,
        });
    }
  });

  return gaps;
}

export function summarize(gaps) {
  const blocking = gaps.filter((g) => g.severity === "block");
  const byArea = Object.entries(Object.groupBy(gaps, (g) => g.area))
    .map(([area, list]) => `${area} ${list.length}`)
    .join(", ");
  return {
    total: gaps.length,
    blocking: blocking.length,
    healable: gaps.filter((g) => g.heal).length,
    byArea,
  };
}

function markdown(gaps, s) {
  const row = (g) =>
    `| ${g.severity === "block" ? "❌" : "⚠️"} | ${g.area} | ${g.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${String(g.fix).replace(/\|/g, "\\|")} |`;
  return [
    `## Harness gaps: ${s.blocking} blocking, ${s.total - s.blocking} to decide`,
    "",
    s.total
      ? "| | Area | Gap | Fix |\n|---|---|---|---|"
      : "No gaps: every check holds.",
    ...gaps.map(row),
  ].join("\n");
}

async function main(args) {
  if (args.includes("--heal")) {
    for (const gap of (await explore()).filter((g) => g.heal)) {
      try {
        await gap.heal();
        console.error(`[doctor] healed: ${gap.detail}`);
      } catch (error) {
        console.error(
          `[doctor] could not heal ${gap.id}: ${firstLines(error.message, 1)}`,
        );
      }
    }
  }
  const gaps = await explore();
  const s = summarize(gaps);
  const record = {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: s,
    gaps: gaps.map(({ heal, ...g }) => ({ ...g, healable: Boolean(heal) })),
  };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, GAPS_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  if (args.includes("--json")) console.log(JSON.stringify(record, null, 2));
  else if (args.includes("--ci")) console.log(markdown(gaps, s));
  else {
    for (const g of gaps)
      console.log(
        `${g.severity === "block" ? "BLOCK" : "warn "} [${g.area}] ${g.detail}\n        fix: ${g.fix}${g.heal ? " (healable: --heal)" : ""}`,
      );
    console.log(
      `\n[doctor] ${s.blocking} blocking, ${s.total - s.blocking} to decide, ${s.healable} healable — ${s.byArea || "no gaps"}. Written to ${GAPS_FILE}.`,
    );
  }
  process.exit(s.blocking ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[doctor] ${error.message}`);
    process.exit(2);
  });
