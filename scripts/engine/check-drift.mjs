import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_AGENT_MARKER,
  GENERATED_HOOK_MARKER,
  GENERATED_SKILL_MARKER,
  adapterEnabled,
  agentInstructions,
  claudeAgent,
  claudeSettingsText,
  codexInstructionsText,
  copilotAgent,
  copilotHooksText,
  copilotInstructions,
  cursorAgent,
  cursorHooksText,
  cursorRulesText,
  injectRules,
  listSkillFiles,
  portableSkillsEnabled,
  readConfig,
  skillMarkerText,
} from "./templates.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const config = readConfig(root);
const failures = [];

function check(relativePath, expected) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected) {
    failures.push(relativePath);
  }
}

function checkOwnedAbsent(relativePath, marker) {
  const target = path.join(root, relativePath);
  if (
    fs.existsSync(target) &&
    fs.readFileSync(target, "utf8").includes(marker)
  ) {
    failures.push(relativePath);
  }
}

function checkGeneratedDirectory(relativeDirectory, expected) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    const content = fs.readFileSync(path.join(directory, entry.name), "utf8");
    if (
      content.includes(GENERATED_AGENT_MARKER) &&
      !expected.has(relativePath)
    ) {
      failures.push(relativePath);
    }
  }
}

function checkSkillProjection(relativeRoot, enabled) {
  const skills = config.skills ?? [];
  const absolute = path.join(root, relativeRoot);
  const markerPath = path.join(absolute, ".harness-generated");

  if (!enabled || skills.length === 0) {
    if (fs.existsSync(markerPath)) failures.push(relativeRoot);
    return;
  }

  check(
    path.join(relativeRoot, ".harness-generated").replaceAll("\\", "/"),
    skillMarkerText(),
  );
  if (!fs.existsSync(markerPath)) {
    failures.push(relativeRoot);
    return;
  }
  if (!fs.readFileSync(markerPath, "utf8").includes(GENERATED_SKILL_MARKER)) {
    failures.push(relativeRoot);
    return;
  }

  const expectedNames = new Set(skills.map((skill) => skill.name));
  for (const skill of skills) {
    const sourceRoot = path.join(root, skill.source);
    for (const file of listSkillFiles(root, skill.source)) {
      const relativePath = path
        .join(relativeRoot, skill.name, file)
        .replaceAll("\\", "/");
      const expected = fs.readFileSync(path.join(sourceRoot, file), "utf8");
      check(relativePath, expected);
    }
  }

  if (fs.existsSync(absolute)) {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === ".harness-generated") continue;
      if (entry.isDirectory() && !expectedNames.has(entry.name)) {
        failures.push(path.join(relativeRoot, entry.name));
      }
    }
  }
}

const claudeAgents = new Set();
const copilotAgents = new Set();
const cursorAgents = new Set();
const extension = config.agentFileExtension ?? ".agent.md";

for (const agent of config.agents) {
  const instructions = agentInstructions(root, config, agent);
  if (adapterEnabled(config, "claude")) {
    const target = path.join(".claude", "agents", `${agent.name}.md`);
    claudeAgents.add(target);
    check(target, claudeAgent(agent, instructions));
  }
  if (adapterEnabled(config, "copilot")) {
    const target = path.join(".github", "agents", `${agent.name}${extension}`);
    copilotAgents.add(target);
    check(target, copilotAgent(agent, instructions));
  }
  if (adapterEnabled(config, "cursor")) {
    const target = path.join(".cursor", "agents", `${agent.name}.md`);
    cursorAgents.add(target);
    check(target, cursorAgent(agent, instructions));
  }
}

checkGeneratedDirectory(path.join(".claude", "agents"), claudeAgents);
checkGeneratedDirectory(path.join(".github", "agents"), copilotAgents);
checkGeneratedDirectory(path.join(".cursor", "agents"), cursorAgents);

if (adapterEnabled(config, "claude")) {
  check(".claude/settings.json", claudeSettingsText(config));
} else {
  checkOwnedAbsent(".claude/settings.json", '"_generated"');
}

if (adapterEnabled(config, "copilot")) {
  check(".github/copilot-instructions.md", copilotInstructions(config));
  check(".github/hooks/harness.json", copilotHooksText(config));
} else {
  checkOwnedAbsent(
    ".github/copilot-instructions.md",
    "GENERATED FROM harness.config.json",
  );
  checkOwnedAbsent(".github/hooks/harness.json", GENERATED_HOOK_MARKER);
}

if (adapterEnabled(config, "cursor")) {
  check(".cursor/rules/harness.mdc", cursorRulesText(config));
  check(".cursor/hooks.json", cursorHooksText(config));
} else {
  checkOwnedAbsent(
    ".cursor/rules/harness.mdc",
    "GENERATED FROM harness.config.json",
  );
  checkOwnedAbsent(".cursor/hooks.json", '"_generated"');
}

if (adapterEnabled(config, "codex")) {
  check("AGENTS.md", codexInstructionsText(config));
} else {
  checkOwnedAbsent("AGENTS.md", "GENERATED FROM harness.config.json");
}

checkSkillProjection(".claude/skills", adapterEnabled(config, "claude"));
checkSkillProjection(".agents/skills", portableSkillsEnabled(config));

for (const doc of ["CLAUDE.md", "README.md"]) {
  const actual = fs.readFileSync(path.join(root, doc), "utf8");
  const expected = injectRules(actual, config);
  if (!expected || actual !== expected) failures.push(doc);
}

if (failures.length) {
  console.error(`Harness drift: ${[...new Set(failures)].join(", ")}`);
  process.exit(1);
}
console.log("Harness projections are in sync.");
