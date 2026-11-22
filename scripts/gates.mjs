#!/usr/bin/env node
// Human approval gates G0-G5 as a hash ledger, enforced by the qa-harness GSD capability.
//   node scripts/gates.mjs check   --phase-dir <dir> --need G4     exit 1 = blocked (gate predicate)
//   node scripts/gates.mjs status  --phase-dir <dir>               every gate, what reopened it, the exact next command
//   node scripts/gates.mjs card    --phase-dir <dir>               the chat gate card: ticket, progress, Gate summary, command
//   node scripts/gates.mjs approve --phase-dir <dir> G2 <artifact>... human, interactive terminal only
//   node scripts/gates.mjs exempt  --phase-dir <dir>               human, interactive terminal only
//   node scripts/gates.mjs --self-test
// Ledger: <phase-dir>/APPROVALS.json. A gate is valid while every recorded artifact still has the
// approved sha256, so editing an approved artifact reopens its gate and every gate after it.
//
// Phase terms are marker lines in a *-CONTEXT.md, with the prefix from harness.config.json
// `gates.markerPrefix` (default "Harness"):
//   <P> tier: S|M|L                 S: `approve G0` records G0+G1+G2 from one prompt
//   <P> spec change: none           with tier S, drops G3
//   <P> gates: exempt - <reason>    exempts the phase once a human records its hash (`exempt`)
//   <P> gate scheme: g0-g5 - <note> moves a ledger that predates G0 (G1-G4) onto G0-G5
// Tier and spec change count only while that CONTEXT is a G0-approved artifact with its approved hash.
// The card's ticket key comes from `gates.ticketPattern` (a regex source), when the profile declares one.
// Anything missing or unreadable is a reason; nothing here ever passes on a missing input.
//
// Ported from the FHF engine's fhf-gates.mjs (same ledger format, same hash), so a phase recorded by
// either one reads the same in both.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const GATES = ["G0", "G1", "G2", "G3", "G4", "G5"];
const NAME = {
  G0: "requirements and scope",
  G1: "scenarios",
  G2: "test plan",
  G3: "test cases",
  G4: "implementation diff",
  G5: "execution evidence",
};
// Scheme pin: a ledger written before G0 existed (G1-G4 recorded, no G0, no `scheme`) keeps the old
// gates, so a scheme change applies to new phases only. `map` sends each current gate to its legacy
// gate; null = that gate did not exist then.
const LEGACY = {
  gates: ["G1", "G2", "G3", "G4"],
  names: { G1: "scenarios", G2: "test plan", G3: "test cases", G4: "evidence" },
  map: { G0: null, G1: "G1", G2: "G2", G3: "G3", G4: null, G5: "G4" },
};
export const BUDGET = { S: 30, M: 120, L: null }; // minutes of work; L is set at G0
const SCRIPT = "node scripts/gates.mjs";
const isContext = (p) => /-CONTEXT\.md$/.test(p);
// A gate predicate may pass PHASE_DIR as an absolute Windows path; normalise backslashes before resolving.
const slashes = (p) => String(p).replace(/\\/g, "/");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Project root = first ancestor holding .planning; ledger artifact paths are stored relative to it.
const findRoot = (d) => {
  for (let p = d; ; p = dirname(p)) {
    if (existsSync(join(p, ".planning"))) return p;
    if (dirname(p) === p) return null;
  }
};
// Raw bytes (no UTF-8 decode, so binary edits are seen) with CRLF pairs folded to LF; latin1 round-trips bytes exactly.
const sha = (p) =>
  createHash("sha256")
    .update(
      Buffer.from(
        readFileSync(p).toString("latin1").replace(/\r\n/g, "\n"),
        "latin1",
      ),
    )
    .digest("hex");
// An artifact must live inside the project root.
const contained = (root, p) => {
  const r = relative(root, resolve(root, p));
  return !isAbsolute(r) && !/^\.\.([\\/]|$)/.test(r);
};

// The project's gate settings: harness.config.json `gates` (HARNESS_CONFIG overrides the file), else the
// defaults. An unreadable config is the defaults too: the markers then simply do not match, which keeps
// every gate closed.
export function gateSettings(root) {
  let gates;
  try {
    const file =
      process.env.HARNESS_CONFIG ?? join(root, "harness.config.json");
    gates = JSON.parse(readFileSync(file, "utf8")).gates ?? {};
  } catch {
    gates = {};
  }
  const p = escape(gates.markerPrefix || "Harness");
  return {
    prefix: gates.markerPrefix || "Harness",
    ticket: gates.ticketPattern ? new RegExp(gates.ticketPattern, "i") : null,
    TIER: new RegExp(`^[ \\t]*${p} tier:[ \\t]*([SML])\\b`, "m"),
    SPEC_NONE: new RegExp(`^[ \\t]*${p} spec change:[ \\t]*none\\b`, "im"),
    MIGRATED: new RegExp(
      `^[ \\t]*${p} gate scheme:[ \\t]*g0-g5[ \\t]*-[ \\t]*\\S`,
      "m",
    ),
    // [ \t] keeps the reason on the marker's own line.
    MARKER: new RegExp(
      `^[ \\t]*${p} gates:[ \\t]*exempt[ \\t]*-[ \\t]*(\\S.*?)[ \\t]*$`,
      "m",
    ),
  };
}

export const exemptReason = (text, root = ".") =>
  text.match(gateSettings(root).MARKER)?.[1] ?? null;

// The marker line a human would be exempting: { context (root-relative), line, reason, sha256 of the trimmed line }.
export function exemptionRecord(phaseDir) {
  const dir = resolve(slashes(phaseDir));
  const root = existsSync(dir) ? findRoot(dir) : null;
  if (!root) return null;
  const { MARKER } = gateSettings(root);
  for (const f of readdirSync(dir)
    .filter((x) => isContext(x))
    .sort()) {
    const m = readFileSync(join(dir, f), "utf8").match(MARKER);
    if (m) {
      const line = m[0].trim();
      return {
        context: slashes(relative(root, join(dir, f))),
        line,
        reason: m[1],
        sha256: createHash("sha256").update(line).digest("hex"),
      };
    }
  }
  return null;
}

// The reason, only while a human-recorded ledger entry matches the current marker line; else null.
export function exemptionOf(phaseDir) {
  const rec = exemptionRecord(phaseDir);
  if (!rec) return null;
  let ex;
  try {
    ex = JSON.parse(
      readFileSync(join(resolve(slashes(phaseDir)), "APPROVALS.json"), "utf8"),
    )?.exempt;
  } catch {
    return null;
  }
  return ex &&
    ex.context === rec.context &&
    ex.sha256 === rec.sha256 &&
    typeof ex.approvedBy === "string" &&
    ex.approvedBy
    ? rec.reason
    : null;
}

// null = unreadable; {} = no ledger yet.
function readLedger(dir) {
  const file = join(dir, "APPROVALS.json");
  if (!existsSync(file)) return {};
  try {
    const l = JSON.parse(readFileSync(file, "utf8"));
    return l && typeof l === "object" && !Array.isArray(l) ? l : null;
  } catch {
    return null;
  }
}

const isLegacy = (dir, root, ledger) =>
  !ledger.scheme &&
  !ledger.G0 &&
  LEGACY.gates.some((g) => ledger[g]) &&
  !readdirSync(dir)
    .filter(isContext)
    .some((f) =>
      gateSettings(root).MIGRATED.test(readFileSync(join(dir, f), "utf8")),
    );

// One gate's own record: '' when every artifact still has its approved hash, else the reason.
function own(root, ledger, x, names) {
  const rec = ledger[x];
  if (!rec) return `${x} (${names[x]}) has no human approval`;
  if (!Array.isArray(rec.artifacts) || !rec.artifacts.length)
    return "ledger unreadable";
  for (const a of rec.artifacts) {
    if (typeof a?.path !== "string" || typeof a?.sha256 !== "string")
      return "ledger unreadable";
    if (!contained(root, a.path))
      return `${x}: approved artifact ${a.path} is outside the project`;
    const p = resolve(root, a.path);
    if (!existsSync(p)) return `${x}: approved artifact ${a.path} is missing`;
    if (sha(p) !== a.sha256)
      return `${x}: ${a.path} changed after approval; ${x} is reopened`;
  }
  return "";
}

// Tier and spec-change lines, read only from a G0-approved CONTEXT whose hash still holds.
export function phaseTerms(root, ledger) {
  const { TIER, SPEC_NONE } = gateSettings(root);
  const texts = (
    Array.isArray(ledger?.G0?.artifacts) ? ledger.G0.artifacts : []
  )
    .filter(
      (a) =>
        typeof a?.path === "string" &&
        isContext(a.path) &&
        contained(root, a.path),
    )
    .filter(
      (a) =>
        existsSync(resolve(root, a.path)) &&
        sha(resolve(root, a.path)) === a.sha256,
    )
    .map((a) => readFileSync(resolve(root, a.path), "utf8"));
  return {
    tier: texts.map((t) => t.match(TIER)?.[1]).find(Boolean) ?? "M",
    specNone: texts.some((t) => SPEC_NONE.test(t)),
  };
}

// The gates this phase needs, in order: a legacy ledger keeps G1-G4; tier S with no spec change skips G3.
function plan(dir, root, ledger) {
  if (isLegacy(dir, root, ledger))
    return {
      scheme: "g1-g4",
      order: LEGACY.gates,
      gates: LEGACY.gates,
      names: LEGACY.names,
      tier: "M",
    };
  const { tier, specNone } = phaseTerms(root, ledger);
  return {
    scheme: "g0-g5",
    order: GATES,
    gates: GATES.filter(
      (g) => !(g === "G3" && tier === "S" && specNone && !ledger.G3),
    ),
    names: NAME,
    tier,
  };
}

// The phase's approved tier for importers; M when nothing approved says otherwise.
export function tierOf(phaseDir) {
  const dir = resolve(slashes(phaseDir));
  const root = existsSync(dir) ? findRoot(dir) : null;
  const ledger = root ? readLedger(dir) : null;
  return root && ledger && !isLegacy(dir, root, ledger)
    ? phaseTerms(root, ledger)
    : { tier: "M", specNone: false };
}

function why(dir, root, g) {
  const ledger = readLedger(dir);
  if (!ledger) return "ledger unreadable";
  const p = plan(dir, root, ledger);
  const target = p.scheme === "g1-g4" ? LEGACY.map[g] : g;
  if (!target) return ""; // the gate did not exist in the phase's pinned scheme
  // A gate needs every earlier gate valid; a gate the tier skips is not in p.gates.
  for (const x of p.order
    .slice(0, p.order.indexOf(target) + 1)
    .filter((x) => p.gates.includes(x))) {
    const r = own(root, ledger, x, p.names);
    if (r) return r;
  }
  return "";
}

// Suggested artifacts for a gate nobody recorded yet: what the phase dir holds, else a placeholder.
// Before G0 the tier is not approved yet; the CONTEXT's own tier line only shapes the suggestion, never a gate.
function suggest(dir, root, g) {
  const { TIER } = gateSettings(root);
  const pick = (re) =>
    readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => slashes(relative(root, join(dir, f))));
  const s = readdirSync(dir)
    .filter(isContext)
    .some((f) => TIER.exec(readFileSync(join(dir, f), "utf8"))?.[1] === "S");
  const by = {
    G0: [/-CONTEXT\.md$/, ...(s ? [/-SCENARIOS\.md$/, /-PLAN\.md$/] : [])],
    G1: [/-SCENARIOS\.md$/],
    G2: [/-PLAN\.md$/],
  };
  const placeholder = {
    G2: "<test plan>",
    G3: "<test cases>",
    G4: "<every changed implementation file>",
    G5: "<execution evidence>",
  };
  return {
    paths: (by[g] ?? []).flatMap(pick),
    placeholder: placeholder[g] ?? "<artifact>",
  };
}

// Gate card: the `## Gate summary` block an artifact carries. It sits inside the hashed file, so editing the
// summary reopens the gate like any other edit; approve and card print it so the human reads what they sign.
export function gateSummary(text) {
  return (
    String(text)
      .match(
        /^##[ \t]+Gate summary[ \t]*\r?\n([\s\S]*?)(?=^##?[ \t]|(?![\s\S]))/m,
      )?.[1]
      .trim() || null
  );
}
const summaryLines = (root, paths) =>
  paths.flatMap((p) => {
    const f = resolve(root, p);
    const s = existsSync(f) ? gateSummary(readFileSync(f, "latin1")) : null;
    return [
      p,
      ...(s
        ? s.split(/\r?\n/).map((l) => `    ${l}`)
        : ["    (no Gate summary: review the file itself)"]),
    ];
  });

// Every gate's state and the exact next command. `status` prints it; `approve` prints its next line.
export function phaseStatus(phaseDir) {
  const dir = resolve(slashes(phaseDir));
  const root = existsSync(dir) ? findRoot(dir) : null;
  if (!root)
    return {
      lines: ["phase dir missing or no .planning folder above it"],
      next: "",
    };
  const ex = exemptionOf(dir);
  if (ex) return { lines: [`exempt: ${ex}`], next: "" };
  const ledger = readLedger(dir);
  if (!ledger)
    return {
      lines: ["ledger unreadable: fix or delete APPROVALS.json"],
      next: "",
    };
  const p = plan(dir, root, ledger);
  const budget = BUDGET[p.tier];
  const since = ledger.G0?.approvedAt
    ? Math.round((Date.now() - Date.parse(ledger.G0.approvedAt)) / 60000)
    : null;
  const lines = [
    `scheme ${p.scheme}${p.scheme === "g1-g4" ? " (pinned: ledger predates G0)" : ""} · tier ${p.tier} · budget ${budget ? `${budget} min of work` : "set at G0"}${since == null ? "" : ` · ${since} min since G0 was recorded (waits included)`}`,
  ];
  let first = "";
  const progress = [];
  for (const g of p.gates) {
    const r = own(root, ledger, g, p.names);
    const held = !r
      ? `recorded ${ledger[g].approvedAt ?? ""}${first ? `, but invalid until ${first} holds` : ""}`
      : "";
    lines.push(
      `${g} ${p.names[g]}: ${held || (ledger[g] ? `REOPENED: ${r}` : "not recorded")}`,
    );
    progress.push(
      `${g} ${!r && !first ? "ok" : ledger[g] && r ? "reopened" : "open"}`,
    );
    if (r && !first) first = g;
  }
  if (p.scheme === "g0-g5" && !p.gates.includes("G3")) {
    lines.push(
      `G3 test cases: not needed (tier S, ${gateSettings(root).prefix} spec change: none)`,
    );
    progress.splice(3, 0, "G3 n/a");
  }
  // Tier S records G0, G1 and G2 from one `approve G0` prompt.
  const g = p.tier === "S" && ["G0", "G1", "G2"].includes(first) ? "G0" : first;
  const sug = g && !ledger[g] ? suggest(dir, root, g) : null;
  const paths = !g
    ? []
    : ledger[g]
      ? ledger[g].artifacts.map((a) => a.path)
      : sug.paths;
  const arts = paths.length
    ? paths.map((x) => `"${x}"`).join(" ")
    : (sug?.placeholder ?? "");
  const next = g
    ? `${SCRIPT} approve --phase-dir "${slashes(dir)}" ${g} ${arts}`
    : "";
  lines.push(
    next ? `next (human, interactive terminal): ${next}` : "all gates hold",
  );
  return {
    lines,
    next,
    gate: g,
    paths,
    progress: progress.join(" · "),
    tier: p.tier,
    root,
  };
}

// The chat card an agent shows before every approval, built from the ledger (never from memory):
// header (ticket · phase · tier), G0-G5 progress, the next gate's Gate summary blocks, the exact command.
export function gateCard(phaseDir) {
  const dir = resolve(slashes(phaseDir));
  const st = phaseStatus(dir);
  if (!st.progress) return st.lines;
  const name = dir.split(/[\\/]/).pop();
  const ctx = readdirSync(dir)
    .filter(isContext)
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const pattern = gateSettings(st.root).ticket;
  const ticket =
    (pattern && `${name} ${ctx}`.match(pattern)?.[0].toUpperCase()) ||
    "no ticket key";
  const header = `${ticket} · ${name} · tier ${st.tier}`;
  if (!st.gate) return [header, st.progress, "All gates hold."];
  return [
    header,
    st.progress,
    "",
    `Approve ${st.gate}:`,
    ...(st.paths.length
      ? summaryLines(st.root, st.paths)
      : ["(the artifacts for this gate are not written yet)"]),
    "",
    `Run it yourself: ${st.next}`,
  ];
}

export function gateReason(phaseDir, need) {
  if (!GATES.includes(need)) return `unknown gate ${need}`;
  if (!phaseDir) return "no phase dir given";
  const dir = resolve(slashes(phaseDir));
  if (!existsSync(dir)) return `phase dir missing: ${dir}`;
  const root = findRoot(dir);
  if (!root) return "no .planning folder above the phase dir";
  if (exemptionOf(dir)) return "";
  return why(dir, root, need);
}

// The agent's shell has no TTY, so a human decision cannot be produced by an agent command.
const needTty = (cmd) => {
  if (process.stdin.isTTY && process.stdout.isTTY) return 0;
  console.error(`${cmd} is human-only: run it in an interactive terminal`);
  return 2;
};
const who = () => process.env.USERNAME || process.env.USER || "unknown";

async function exempt(dir) {
  const rec = exemptionRecord(dir);
  if (!rec) {
    const { prefix } = gateSettings(findRoot(dir));
    console.error(
      `no \`${prefix} gates: exempt - <reason>\` line in a *-CONTEXT.md of this phase`,
    );
    return 1;
  }
  const tty = needTty("exempt");
  if (tty) return tty;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (
    await rl.question(
      `Exempt this phase from G0-G5:\n  ${rec.context}\n  ${rec.line}\n  sha256 ${rec.sha256}\nType "approved": `,
    )
  ).trim();
  rl.close();
  if (ans !== "approved") {
    console.error("not approved");
    return 1;
  }
  if (exemptionRecord(dir)?.sha256 !== rec.sha256) {
    console.error("marker line changed while you were deciding; not recorded");
    return 1;
  }
  const file = join(dir, "APPROVALS.json");
  let ledger = {};
  if (existsSync(file)) {
    try {
      ledger = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      console.error("ledger unreadable");
      return 1;
    }
  }
  ledger.exempt = {
    ...rec,
    approvedAt: new Date().toISOString(),
    approvedBy: who(),
  };
  writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`exemption recorded: ${rec.reason}`);
  return 0;
}

// What one approval records, before any prompt: { error } or { ledger, gates, label, order }.
// A legacy-pinned phase approves its own G1-G4; tier S approving G0 with a CONTEXT that says
// `<prefix> tier: S` records G0, G1 and G2 from that one prompt ("scope, scenarios and plan").
function approvalPlan(dir, root, g, files) {
  const ledger = readLedger(dir);
  if (!ledger) return { error: "ledger unreadable" };
  const legacy = isLegacy(dir, root, ledger);
  const order = legacy ? LEGACY.gates : GATES;
  const { TIER, prefix } = gateSettings(root);
  if (!order.includes(g))
    return {
      error: legacy
        ? `this phase is pinned to the G1-G4 scheme (its ledger predates G0); approve G1..G4, or add \`${prefix} gate scheme: g0-g5 - <migration note>\` to its CONTEXT`
        : `unknown gate ${g}`,
    };
  const i = order.indexOf(g);
  const prior =
    i === 0
      ? ""
      : legacy
        ? (order
            .slice(0, i)
            .map((x) => own(root, ledger, x, LEGACY.names))
            .find(Boolean) ?? "")
        : why(dir, root, order[i - 1]);
  if (prior) return { error: `cannot approve ${g}: ${prior}` };
  const tierS =
    !legacy &&
    g === "G0" &&
    files.some(
      (f) =>
        isContext(f) &&
        TIER.exec(readFileSync(resolve(root, slashes(f)), "utf8"))?.[1] === "S",
    );
  return {
    ledger,
    order,
    gates: tierS ? ["G0", "G1", "G2"] : [g],
    label: tierS
      ? "scope, scenarios and plan (tier S: records G0, G1 and G2)"
      : (legacy ? LEGACY.names : NAME)[g],
    legacy,
  };
}

function writeApproval(dir, ap, seen, by) {
  const at = new Date().toISOString();
  for (const x of ap.gates)
    ap.ledger[x] = { artifacts: seen, approvedAt: at, approvedBy: by };
  for (const later of ap.order.slice(ap.order.indexOf(ap.gates.at(-1)) + 1))
    delete ap.ledger[later];
  if (!ap.legacy) ap.ledger.scheme = "g0-g5";
  writeFileSync(
    join(dir, "APPROVALS.json"),
    JSON.stringify(ap.ledger, null, 2) + "\n",
  );
}

async function approve(rest, dir, root) {
  const [g, ...files] = rest.filter(
    (a, i) => !a.startsWith("--") && rest[i - 1] !== "--phase-dir",
  );
  if (!GATES.includes(g) || !files.length) {
    console.error(
      "approve needs a gate (G0..G5) and at least one artifact path",
    );
    return 2;
  }
  const abs = (p) => resolve(root, slashes(p));
  for (const f of files) {
    if (!contained(root, abs(f))) {
      console.error(`artifact is outside the project: ${f}`);
      return 1;
    }
    if (!existsSync(abs(f))) {
      console.error(`artifact not found: ${f}`);
      return 1;
    }
  }
  const tty = needTty("approve");
  if (tty) return tty;
  const ap = approvalPlan(dir, root, g, files);
  if (ap.error) {
    console.error(ap.error);
    return 1;
  }
  // The human sees each hash, and exactly those hashes are written; a change during the prompt aborts.
  const seen = files.map((f) => ({
    path: slashes(relative(root, abs(f))),
    sha256: sha(abs(f)),
  }));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Each artifact's Gate summary is printed from the same bytes that were just hashed.
  const shown = seen.flatMap((a) =>
    summaryLines(root, [a.path]).map((l, i) => (i ? l : `${l}  ${a.sha256}`)),
  );
  const ans = (
    await rl.question(
      `Approve ${ap.gates.join("+")} (${ap.label}) for:\n  ${shown.join("\n  ")}\nType "approved": `,
    )
  ).trim();
  rl.close();
  if (ans !== "approved") {
    console.error("not approved");
    return 1;
  }
  if (
    files.some((f, i) => !existsSync(abs(f)) || sha(abs(f)) !== seen[i].sha256)
  ) {
    console.error("artifact changed while you were deciding; not approved");
    return 1;
  }
  writeApproval(dir, ap, seen, who());
  console.log(`${ap.gates.join(", ")} approved`);
  const { next } = phaseStatus(dir);
  console.log(next ? `Next gate: ${next}` : "All gates hold.");
  return 0;
}

function selfTest() {
  const ws = mkdtempSync(join(tmpdir(), "harness-gates-st-"));
  const phase = join(ws, ".planning", "phases", "99-x");
  mkdirSync(phase, { recursive: true });
  const art = (n) => `.planning/phases/99-x/${n}`;
  for (const n of ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"])
    writeFileSync(join(ws, art(n)), `# ${n}\nline\n`);
  const led = (g, n, over = {}) => {
    const f = join(phase, "APPROVALS.json");
    const l = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    l[g] = {
      artifacts: [{ path: art(n), sha256: sha(join(ws, art(n))) }],
      ...over,
    };
    writeFileSync(f, JSON.stringify(l));
  };
  assert.match(
    gateReason(phase, "G0"),
    /G0 .*no human approval/,
    "missing ledger blocks",
  );
  assert.match(gateReason(join(ws, "nope"), "G1"), /phase dir missing/);
  assert.match(gateReason("", "G1"), /no phase dir/);
  assert.match(gateReason(phase, "G9"), /unknown gate/);
  led("G0", "a.md");
  assert.equal(gateReason(phase, "G0"), "");
  assert.match(gateReason(phase, "G1"), /G1/, "G1 requires G0");
  led("G1", "b.md");
  assert.equal(gateReason(phase, "G1"), "");
  assert.match(
    gateReason(phase, "G3"),
    /G2/,
    "G3 needs G2 as well as G0 and G1",
  );
  led("G2", "c.md");
  led("G3", "d.md");
  assert.equal(gateReason(phase, "G3"), "");
  assert.match(gateReason(phase, "G4"), /G4/);
  led("G4", "e.md");
  assert.match(gateReason(phase, "G5"), /G5/);
  led("G5", "f.md");
  assert.equal(gateReason(phase, "G5"), "");
  // The Windows form a gate predicate passes: backslashes.
  assert.equal(gateReason(phase.replace(/\//g, "\\"), "G5"), "");
  // CRLF is the same hash; a real edit reopens its gate and every later gate, not the earlier ones.
  writeFileSync(join(ws, art("c.md")), "# c.md\r\nline\r\n");
  assert.equal(gateReason(phase, "G5"), "", "CRLF-only change keeps the hash");
  appendFileSync(join(ws, art("c.md")), "edited\n");
  assert.match(
    gateReason(phase, "G5"),
    /c\.md changed after approval; G2 is reopened/,
  );
  assert.equal(gateReason(phase, "G1"), "");
  // A path outside the project blocks; a swapped invalid UTF-8 byte reopens the gate.
  writeFileSync(
    join(ws, "..", `harness-gates-st-out-${process.pid}.md`),
    "x\n",
  );
  writeFileSync(
    join(phase, "APPROVALS.json"),
    JSON.stringify({
      G0: {
        artifacts: [
          { path: `../harness-gates-st-out-${process.pid}.md`, sha256: "x" },
        ],
      },
    }),
  );
  assert.match(gateReason(phase, "G0"), /outside the project/);
  writeFileSync(join(ws, art("bin.dat")), Buffer.from([0x80, 0x0a]));
  writeFileSync(
    join(phase, "APPROVALS.json"),
    JSON.stringify({
      G0: {
        artifacts: [
          { path: art("bin.dat"), sha256: sha(join(ws, art("bin.dat"))) },
        ],
      },
    }),
  );
  assert.equal(gateReason(phase, "G0"), "");
  writeFileSync(join(ws, art("bin.dat")), Buffer.from([0x81, 0x0a]));
  assert.match(gateReason(phase, "G0"), /changed after approval/);
  // Unreadable or malformed ledger blocks.
  writeFileSync(join(phase, "APPROVALS.json"), "{broken");
  assert.equal(gateReason(phase, "G1"), "ledger unreadable");
  writeFileSync(
    join(phase, "APPROVALS.json"),
    JSON.stringify({ G0: { artifacts: [] } }),
  );
  assert.equal(gateReason(phase, "G0"), "ledger unreadable");
  // Exemption marker (default prefix): a non-empty reason only, and only with the human ledger record.
  assert.equal(
    exemptReason("x\nHarness gates: exempt - harness only\n", ws),
    "harness only",
  );
  assert.equal(
    exemptReason("Harness gates: exempt - \nnext line", ws),
    null,
    "empty reason is no marker",
  );
  assert.equal(exemptReason("Harness gates: exempt", ws), null);
  writeFileSync(
    join(phase, "99-CONTEXT.md"),
    "Harness gates: exempt - harness only\n",
  );
  assert.match(
    gateReason(phase, "G0"),
    /unreadable/,
    "marker alone stays gated",
  );
  assert.equal(exemptionOf(phase), null);
  const rec = exemptionRecord(phase);
  writeFileSync(
    join(phase, "APPROVALS.json"),
    JSON.stringify({
      exempt: { ...rec, approvedAt: "t", approvedBy: "selftest" },
    }),
  );
  assert.equal(gateReason(phase, "G5"), "");
  assert.equal(exemptionOf(phase), "harness only");
  writeFileSync(
    join(phase, "99-CONTEXT.md"),
    "Harness gates: exempt - harness only, edited\n",
  );
  assert.equal(exemptionOf(phase), null, "editing the marker reopens");
  writeFileSync(
    join(phase, "99-CONTEXT.md"),
    "Harness gates: exempt - harness only\n",
  );
  const ex = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "exempt", "--phase-dir", phase],
    { encoding: "utf8", input: "approved\n" },
  );
  assert.equal(ex.status, 2);
  assert.match(ex.stderr, /human-only/);
  // approve refuses without a TTY (this child has piped stdio).
  const r = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "approve",
      "--phase-dir",
      phase,
      "G1",
      art("a.md"),
    ],
    { encoding: "utf8", input: "approved\n" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /human-only/);

  const record = (dir, g, files, root = ws) => {
    const ap = approvalPlan(dir, root, g, files);
    if (ap.error) return ap.error;
    writeApproval(
      dir,
      ap,
      files.map((f) => ({ path: f, sha256: sha(join(root, f)) })),
      "selftest",
    );
    return ap.gates.join(",");
  };
  // Tier S: one G0 prompt records G0+G1+G2; `spec change: none` drops G3; the tier counts only under G0.
  const sDir = join(ws, ".planning", "phases", "98-s");
  mkdirSync(sDir, { recursive: true });
  const s = (n) => `.planning/phases/98-s/${n}`;
  writeFileSync(
    join(ws, s("98-CONTEXT.md")),
    "Harness tier: S\nHarness spec change: none\n",
  );
  for (const n of ["98-SCENARIOS.md", "98-01-PLAN.md", "impl.js", "sheet.md"])
    writeFileSync(join(ws, s(n)), `${n}\n`);
  assert.match(
    phaseStatus(sDir).next,
    / G0 ".*98-CONTEXT\.md" ".*98-SCENARIOS\.md" ".*98-01-PLAN\.md"$/,
    "S suggests one merged G0",
  );
  assert.equal(
    record(sDir, "G0", [
      s("98-CONTEXT.md"),
      s("98-SCENARIOS.md"),
      s("98-01-PLAN.md"),
    ]),
    "G0,G1,G2",
  );
  assert.equal(gateReason(sDir, "G3"), "", "no spec change: G3 not needed");
  assert.match(gateReason(sDir, "G4"), /G4/);
  assert.match(
    phaseStatus(sDir).lines.join("\n"),
    /tier S · budget 30 min[\s\S]*G3 test cases: not needed[\s\S]*next .* G4 <every changed implementation file>/,
  );
  assert.equal(record(sDir, "G4", [s("impl.js")]), "G4");
  assert.equal(record(sDir, "G5", [s("sheet.md")]), "G5");
  assert.equal(phaseStatus(sDir).next, "");
  assert.equal(
    JSON.parse(readFileSync(join(sDir, "APPROVALS.json"), "utf8")).scheme,
    "g0-g5",
  );
  appendFileSync(join(ws, s("98-CONTEXT.md")), "edited\n");
  assert.match(
    gateReason(sDir, "G5"),
    /98-CONTEXT\.md changed after approval; G0 is reopened/,
    "editing the tier line reopens G0",
  );
  // A tier line in a CONTEXT that G0 did not record counts for nothing: the phase is M with all six gates.
  const mDir = join(ws, ".planning", "phases", "97-m");
  mkdirSync(mDir, { recursive: true });
  writeFileSync(join(mDir, "97-CONTEXT.md"), "Harness tier: S\n");
  writeFileSync(join(mDir, "scope.md"), "scope\n");
  assert.equal(record(mDir, "G0", [".planning/phases/97-m/scope.md"]), "G0");
  assert.match(gateReason(mDir, "G2"), /G1 .*no human approval/);
  // Gate card: the summary block is read up to the next heading; no ticket pattern = no ticket key.
  assert.equal(
    gateSummary(
      "# X\n## Gate summary\nTicket: A-1\nTier: S\n\n## Scope\nmore\n",
    ),
    "Ticket: A-1\nTier: S",
  );
  assert.equal(gateSummary("no block"), null);
  const cDir = join(ws, ".planning", "phases", "95-abc-12-x");
  mkdirSync(cDir, { recursive: true });
  writeFileSync(
    join(cDir, "95-CONTEXT.md"),
    "# ctx\n## Gate summary\nIn scope: link\n## Detail\nx\n",
  );
  assert.match(
    gateCard(cDir).join("\n"),
    /^no ticket key · 95-abc-12-x · tier M\nG0 open · G1 open/,
  );
  assert.match(
    gateCard(cDir).join("\n"),
    /Run it yourself: node scripts\/gates\.mjs approve .* G0 "/,
  );
  // Scheme pin: a G1-G4 ledger without G0 keeps its gates; G5 maps to legacy G4.
  const lDir = join(ws, ".planning", "phases", "96-legacy");
  mkdirSync(lDir, { recursive: true });
  writeFileSync(join(lDir, "96-CONTEXT.md"), "# ctx\n");
  writeFileSync(
    join(lDir, "APPROVALS.json"),
    JSON.stringify({
      G1: {
        artifacts: [{ path: art("a.md"), sha256: sha(join(ws, art("a.md"))) }],
      },
    }),
  );
  assert.equal(gateReason(lDir, "G0"), "", "legacy: no G0");
  assert.match(
    gateReason(lDir, "G5"),
    /G2/,
    "legacy G5 = old G4 evidence, which needs G1-G3",
  );
  writeFileSync(
    join(lDir, "96-CONTEXT.md"),
    "Harness gate scheme: g0-g5 - migrated, owner decision\n",
  );
  assert.match(
    gateReason(lDir, "G1"),
    /G0 .*no human approval/,
    "a migration note moves the phase to G0-G5",
  );

  // Profile settings: a consumer's prefix and ticket pattern replace the defaults; the default prefix
  // then means nothing, so a marker in the wrong prefix never relaxes a gate.
  const pws = mkdtempSync(join(tmpdir(), "harness-gates-profile-"));
  writeFileSync(
    join(pws, "harness.config.json"),
    JSON.stringify({
      gates: { markerPrefix: "ACME", ticketPattern: "\\b(ABC|XYZ)-\\d+\\b" },
    }),
  );
  const pDir = join(pws, ".planning", "phases", "01-abc-7-login");
  mkdirSync(pDir, { recursive: true });
  const pp = (n) => `.planning/phases/01-abc-7-login/${n}`;
  writeFileSync(
    join(pws, pp("01-CONTEXT.md")),
    "ACME tier: S\nACME spec change: none\n## Gate summary\nScope: login\n",
  );
  writeFileSync(join(pws, pp("01-SCENARIOS.md")), "s\n");
  assert.match(gateCard(pDir).join("\n"), /^ABC-7 · 01-abc-7-login · tier M/);
  assert.equal(
    record(pDir, "G0", [pp("01-CONTEXT.md"), pp("01-SCENARIOS.md")], pws),
    "G0,G1,G2",
    "the profile prefix carries the tier",
  );
  assert.equal(gateReason(pDir, "G3"), "");
  writeFileSync(
    join(pDir, "02-CONTEXT.md"),
    "Harness gates: exempt - wrong prefix\n",
  );
  assert.equal(
    exemptionRecord(pDir),
    null,
    "the default prefix is not a marker under a profile prefix",
  );
  console.log("gates self-test: ok");
}

async function main(args) {
  const [cmd, ...rest] = args;
  if (cmd === "--self-test") return selfTest();
  const flag = (n) => {
    const i = rest.indexOf(n);
    return i < 0 ? undefined : rest[i + 1];
  };
  const rawDir = flag("--phase-dir");
  if (
    !["check", "status", "card", "approve", "exempt"].includes(cmd) ||
    !rawDir
  ) {
    console.error(
      "usage: gates.mjs check --phase-dir <dir> --need G0..G5 | status --phase-dir <dir> | card --phase-dir <dir> | approve --phase-dir <dir> <G0..G5> <artifact>... | exempt --phase-dir <dir> | --self-test",
    );
    process.exit(2);
  }
  const dir = resolve(slashes(rawDir));
  const root = existsSync(dir) ? findRoot(dir) : null;
  if (cmd === "status" || cmd === "card") {
    for (const l of cmd === "card" ? gateCard(dir) : phaseStatus(dir).lines)
      console.log(l);
  } else if (cmd === "check") {
    const need = flag("--need");
    if (!GATES.includes(need)) {
      console.error("--need must be one of G0..G5");
      process.exit(2);
    }
    const reason = gateReason(dir, need);
    if (reason) {
      const unrecorded = exemptionRecord(dir)
        ? ` The phase carries an exempt marker line, but a marker exempts nothing until a human records it: ${SCRIPT} exempt --phase-dir "${dir}"`
        : "";
      const { next } = phaseStatus(dir);
      console.error(
        `Gate ${need} blocked: ${reason}. ${next ? `Next (human, interactive terminal): ${next}` : `A human approves it with: ${SCRIPT} approve --phase-dir "${dir}" <gate> <artifact>`}. All gates: ${SCRIPT} status --phase-dir "${dir}".${unrecorded}`,
      );
      process.exit(1);
    }
    const ex = exemptionOf(dir);
    console.log(ex ? `Gates exempt: ${ex}` : `Gate ${need} satisfied`);
  } else {
    if (!root) {
      console.error("phase dir missing or no .planning folder above it");
      process.exit(2);
    }
    process.exit(
      cmd === "exempt" ? await exempt(dir) : await approve(rest, dir, root),
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));
