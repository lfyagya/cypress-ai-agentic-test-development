import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GSD_WORKFLOW } from "../../harness/workflow-model.mjs";
import {
  adapterEnabled,
  agentInstructions,
  claudeAgent,
  copilotAgent,
  copilotHooks,
  copilotTools,
  cursorAgent,
  cursorHooks,
  readConfig,
} from "./templates.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..", "..");
const config = readConfig(root);

assert.equal(adapterEnabled({ adapters: { claude: { enabled: false } } }, "claude"), false);
assert.equal(adapterEnabled({}, "claude"), false);

// Skills are pinned under harness/skills and bound to lifecycle roles. Sync projects them to
// .claude/skills and .agents/skills only.
assert.ok(Array.isArray(config.skills) && config.skills.length >= 3, "skills[] missing");
for (const name of ["cypress-author", "cypress-explain", "cypress-docs"]) {
  const skill = config.skills.find((s) => s.name === name);
  assert.ok(skill, `skills[] must declare ${name}`);
  assert.match(skill.source, /^harness\/skills\//, `${name}.source must be under harness/skills/`);
  assert.match(skill.version, /^\d+\.\d+\.\d+$/, `${name}.version must be a semver pin`);
  assert.ok(Array.isArray(skill.roles) && skill.roles.length > 0, `${name}.roles required`);
  assert.ok(
    fs.existsSync(path.join(root, skill.source, "SKILL.md")),
    `${skill.source}/SKILL.md missing from canon`,
  );
}

const author = config.skills.find((s) => s.name === "cypress-author");
assert.ok(author.roles.includes("BUILD"));
const explain = config.skills.find((s) => s.name === "cypress-explain");
assert.ok(explain.roles.includes("EVALUATE"));

for (const agent of config.agents) {
  const instructions = agentInstructions(root, config, agent);
  assert.ok(instructions, `${agent.name} has no neutral instructions`);
  assert.ok(
    !instructions.startsWith("---"),
    `${agent.name} source must not contain tool frontmatter`,
  );
  if (adapterEnabled(config, "claude")) {
    assert.equal(
      fs.readFileSync(path.join(root, ".claude", "agents", `${agent.name}.md`), "utf8"),
      claudeAgent(agent, instructions),
    );
  }
  if (adapterEnabled(config, "copilot")) {
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          ".github",
          "agents",
          `${agent.name}${config.agentFileExtension ?? ".agent.md"}`,
        ),
        "utf8",
      ),
      copilotAgent(agent, instructions),
    );
  }
  if (adapterEnabled(config, "cursor")) {
    assert.equal(
      fs.readFileSync(path.join(root, ".cursor", "agents", `${agent.name}.md`), "utf8"),
      cursorAgent(agent, instructions),
    );
  }
}

const gate = config.agents.find((agent) => agent.role === "EVALUATE");
assert.ok(gate, "EVALUATE agent is required");
const gateInstructions = agentInstructions(root, config, gate);
assert.match(gateInstructions, /at least 80\/100/);
assert.match(gateInstructions, /@P0/);
assert.match(gateInstructions, /never grades its own output/i);
assert.match(gateInstructions, /Required Cypress skills for this role/);
assert.match(gateInstructions, /cypress-explain/);
assert.deepEqual(gate.tools, ["Read", "Grep", "Glob"]);
assert.deepEqual(copilotTools(gate), ["read", "search"]);
assert.match(claudeAgent(gate, "gate"), /permissionMode: plan/);
assert.doesNotMatch(claudeAgent(gate, "gate"), /\n {2}- (Bash|Edit|Write)\n/);
assert.match(copilotAgent(gate, "gate"), /tools: \["read","search"\]/);
assert.match(cursorAgent(gate, "gate"), /readonly: true/);

const builder = config.agents.find((agent) => agent.role === "BUILD");
assert.ok(builder, "BUILD agent is required");
const builderInstructions = agentInstructions(root, config, builder);
assert.match(builderInstructions, /SMOKE.*REGRESSION/s);
assert.match(builderInstructions, /failure-safe cleanup/);
assert.match(builderInstructions, /cypress-author/);
assert.match(builderInstructions, /cypress-docs/);

const intake = config.agents.find((agent) => agent.role === "INTAKE");
assert.ok(intake, "INTAKE agent is required");
const intakeInstructions = agentInstructions(root, config, intake);
assert.match(intakeInstructions, /evidence\/requirements\.json/);
assert.match(intakeInstructions, /do not write tests/i);
// INTAKE merges gathering and discovery, so it must also own selector/route capture into config.
assert.match(intakeInstructions, /cypress\/configs\//);
assert.match(intakeInstructions, /Required Cypress skills for this role/);

const hooks = copilotHooks(config);
assert.equal(hooks.version, 1);
assert.ok(hooks.hooks.PreToolUse?.every((hook) => hook.matcher === "Edit|Write"));
assert.ok(
  hooks.hooks.PreToolUse?.every(
    (hook) => hook.env?.HARNESS_GENERATED_FROM === "harness.config.json",
  ),
);
assert.ok(hooks.hooks.userPromptSubmitted?.length >= 1, "Copilot prompt hook missing");
assert.ok(hooks.hooks.agentStop?.length >= 1, "Copilot stop hook missing");
assert.ok(
  hooks.hooks.userPromptSubmitted.some((hook) => hook.command.includes("harness-config-gate")),
  "Copilot prompt hook must run the profile gate first",
);
assert.ok(
  hooks.hooks.userPromptSubmitted.some((hook) => hook.command.includes("prompt-duplication-guard")),
);
assert.ok(hooks.hooks.agentStop.every((hook) => hook.command.includes("session-end-reminder")));

const cursor = cursorHooks(config);
assert.equal(cursor.version, 1);
assert.ok(
  cursor.hooks.preToolUse?.every((hook) => hook.matcher === "Write|StrReplace"),
  "Cursor preToolUse must match Write|StrReplace",
);
assert.ok(
  cursor.hooks.preToolUse?.every((hook) =>
    hook.command.includes("pre-validate-cypress-rules"),
  ),
  "Cursor preToolUse must run the pre-write validator",
);
assert.ok(cursor.hooks.afterFileEdit?.length >= 1, "Cursor afterFileEdit missing");
assert.ok(cursor.hooks.beforeSubmitPrompt?.length >= 1, "Cursor beforeSubmitPrompt missing");
assert.ok(cursor.hooks.stop?.length >= 1, "Cursor stop hook missing");

assert.throws(
  () =>
    agentInstructions(root, config, {
      ...config.agents[0],
      instructions: "../package.json",
    }),
  /must resolve inside harness\/agents/,
);
assert.throws(
  () => agentInstructions(root, { ...config, qaFoundations: "../package.json" }, config.agents[0]),
  /qaFoundations must resolve inside harness\//,
);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "harness-adapter-"));
try {
  const fixtureScripts = path.join(fixture, "scripts", "engine");
  fs.mkdirSync(fixtureScripts, { recursive: true });
  fs.mkdirSync(path.join(fixture, "harness", "agents"), { recursive: true });
  fs.copyFileSync(
    path.join(scriptDirectory, "templates.mjs"),
    path.join(fixtureScripts, "templates.mjs"),
  );
  fs.copyFileSync(path.join(scriptDirectory, "sync.mjs"), path.join(fixtureScripts, "sync.mjs"));
  // templates.mjs imports the engine models, so the sandbox carries every non-test one.
  for (const file of fs.readdirSync(path.join(root, "harness"))) {
    if (file.endsWith(".mjs") && !file.startsWith("test-")) {
      fs.copyFileSync(path.join(root, "harness", file), path.join(fixture, "harness", file));
    }
  }

  const fixtureConfig = {
    version: 1,
    workflow: structuredClone(GSD_WORKFLOW),
    framework: "cypress",
    adapters: {
      claude: { enabled: true },
      copilot: { enabled: true },
      cursor: { enabled: true },
      codex: { enabled: true },
    },
    agentFileExtension: ".md",
    project: {
      name: "fixture",
      architecture: "Config → Commands → Tests",
      configRoot: "config",
      commandRoot: "commands",
      specGlob: "tests/**/*.js",
    },
    context: { effortLevel: "medium" },
    loops: { gateRepairLimit: 2 },
    qaFoundations: "harness/qa-automation-foundations.md",
    rules: [
      {
        id: "fixture-rule",
        severity: "block",
        enforcement: "Hook + CI",
        never: "bad",
        instead: "good",
        why: "fixture",
        message: "fixture",
      },
    ],
    agents: [
      {
        name: "old-agent",
        role: "BUILD",
        description: "fixture",
        tools: ["Read"],
        when: "fixture",
      },
    ],
    hooks: { preWrite: ["pre.mjs"], postWrite: ["post.mjs"], stop: ["stop.mjs"] },
    skills: [
      {
        name: "fixture-skill",
        description: "fixture",
        source: "harness/skills/cypress/fixture-skill",
        version: "1.0.0",
        roles: ["BUILD"],
      },
    ],
    permissions: { defaultMode: "plan", allow: [], deny: [] },
  };
  const configPath = path.join(fixture, "harness.config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(fixtureConfig, null, 2)}\n`);
  fs.writeFileSync(
    path.join(fixture, "harness", "agents", "old-agent.md"),
    "limit={{gateRepairLimit}}\n{{qaFoundations}}\n",
  );
  fs.writeFileSync(path.join(fixture, "harness", "qa-automation-foundations.md"), "foundation\n");
  fs.mkdirSync(path.join(fixture, "harness", "skills", "cypress", "fixture-skill"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(fixture, "harness", "skills", "cypress", "fixture-skill", "SKILL.md"),
    "# fixture skill\n",
  );
  fs.writeFileSync(
    path.join(fixture, "CLAUDE.md"),
    "# Fixture\n\n<!-- HARNESS:RULES:START -->old<!-- HARNESS:RULES:END -->\n",
  );
  fs.writeFileSync(
    path.join(fixture, "README.md"),
    "# Fixture\n\n<!-- HARNESS:RULES:START -->old<!-- HARNESS:RULES:END -->\n",
  );

  const runSync = () =>
    spawnSync(process.execPath, [path.join(fixtureScripts, "sync.mjs")], {
      cwd: path.dirname(fixture),
      encoding: "utf8",
    });
  const enabledRun = runSync();
  assert.equal(enabledRun.status, 0, enabledRun.stderr || enabledRun.stdout);
  assert.match(
    fs.readFileSync(path.join(fixture, ".claude", "agents", "old-agent.md"), "utf8"),
    /limit=2\nfoundation/,
  );
  assert.match(
    fs.readFileSync(path.join(fixture, ".claude", "agents", "old-agent.md"), "utf8"),
    /fixture-skill/,
  );
  assert.ok(fs.existsSync(path.join(fixture, ".github", "hooks", "harness.json")));
  assert.ok(fs.existsSync(path.join(fixture, ".cursor", "agents", "old-agent.md")));
  assert.ok(fs.existsSync(path.join(fixture, ".cursor", "hooks.json")));
  assert.ok(fs.existsSync(path.join(fixture, ".claude", "skills", "fixture-skill", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(fixture, ".agents", "skills", "fixture-skill", "SKILL.md")));

  // Cursor projects a rules file; Codex projects a root AGENTS.md. Both carry the generated banner
  // so a later disable can remove them by marker.
  const cursorRulesPath = path.join(fixture, ".cursor", "rules", "harness.mdc");
  const codexPath = path.join(fixture, "AGENTS.md");
  assert.ok(fs.existsSync(cursorRulesPath), "cursor rules not generated when enabled");
  assert.ok(fs.existsSync(codexPath), "AGENTS.md not generated when codex enabled");
  const cursorText = fs.readFileSync(cursorRulesPath, "utf8");
  assert.match(cursorText, /^---\ndescription: /, "cursor .mdc must start with frontmatter");
  assert.match(cursorText, /alwaysApply: true/, "cursor rule must always apply");
  assert.match(cursorText, /GENERATED FROM harness\.config\.json/);
  assert.match(
    fs.readFileSync(codexPath, "utf8"),
    /GENERATED FROM harness\.config\.json/,
    "AGENTS.md must carry the generated banner",
  );

  fixtureConfig.adapters.claude.enabled = false;
  fixtureConfig.adapters.copilot.enabled = false;
  fixtureConfig.adapters.cursor.enabled = false;
  fixtureConfig.adapters.codex.enabled = false;
  fixtureConfig.agents = [
    {
      name: "new-agent",
      role: "BUILD",
      description: "fixture",
      tools: ["Read"],
      when: "fixture",
    },
  ];
  fs.writeFileSync(configPath, `${JSON.stringify(fixtureConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(fixture, "harness", "agents", "new-agent.md"), "new\n");

  const disabledRun = runSync();
  assert.equal(disabledRun.status, 0, disabledRun.stderr);
  assert.ok(!fs.existsSync(path.join(fixture, ".claude", "agents", "old-agent.md")));
  assert.ok(!fs.existsSync(path.join(fixture, ".github", "agents", "old-agent.md")));
  assert.ok(!fs.existsSync(path.join(fixture, ".cursor", "agents", "old-agent.md")));
  assert.ok(!fs.existsSync(path.join(fixture, ".claude", "settings.json")));
  assert.ok(!fs.existsSync(path.join(fixture, ".github", "copilot-instructions.md")));
  assert.ok(!fs.existsSync(path.join(fixture, ".github", "hooks", "harness.json")));
  assert.ok(!fs.existsSync(cursorRulesPath), "cursor rules survived a disable");
  assert.ok(!fs.existsSync(path.join(fixture, ".cursor", "hooks.json")));
  assert.ok(!fs.existsSync(codexPath), "AGENTS.md survived a codex disable");
  assert.ok(!fs.existsSync(path.join(fixture, ".claude", "skills")));
  assert.ok(!fs.existsSync(path.join(fixture, ".agents", "skills")));
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
