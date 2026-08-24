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

function write(relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
    fs.writeFileSync(target, content, "utf8");
    console.log(`updated ${relativePath}`);
  }
}

function removeOwned(relativePath, marker) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return;
  if (!fs.readFileSync(target, "utf8").includes(marker)) return;
  fs.rmSync(target);
  console.log(`removed ${relativePath}`);
}

function reconcileAgentDirectory(relativeDirectory, expected) {
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
      fs.rmSync(path.join(directory, entry.name));
      console.log(`removed ${relativePath}`);
    }
  }
}

// CLAUDE.md is the harness's instruction surface, so a missing marker pair there is an error.
// README.md is the consumer's front door: an overlaid repo may not have one, or may have one it
// does not want a generated block in. Spec §5 names CLAUDE.md only, so README is optional and
// skipping it is reported rather than silent.
function syncRules(relativePath, { required = true } = {}) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) {
    if (required) {
      throw new Error(
        `${relativePath} is required for the rules block and does not exist`,
      );
    }
    console.log(`skipped ${relativePath} (absent)`);
    return;
  }
  const content = injectRules(fs.readFileSync(target, "utf8"), config);
  if (!content) {
    if (required) {
      throw new Error(
        `${relativePath} needs exactly one HARNESS:RULES marker pair`,
      );
    }
    console.log(`skipped ${relativePath} (no HARNESS:RULES markers)`);
    return;
  }
  write(relativePath, content);
}

function copySkillTree(skill, relativeTargetRoot) {
  const sourceRoot = path.join(root, skill.source);
  const files = listSkillFiles(root, skill.source);
  const skillDir = path.join(relativeTargetRoot, skill.name);
  for (const file of files) {
    const content = fs.readFileSync(path.join(sourceRoot, file), "utf8");
    write(path.join(skillDir, file).replaceAll("\\", "/"), content);
  }
}

function reconcileSkillProjection(relativeRoot, expectedNames) {
  const absolute = path.join(root, relativeRoot);
  const markerPath = path.join(absolute, ".harness-generated");
  if (!fs.existsSync(absolute)) return;
  if (!fs.existsSync(markerPath)) return;
  if (!fs.readFileSync(markerPath, "utf8").includes(GENERATED_SKILL_MARKER))
    return;

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === ".harness-generated") continue;
    if (!entry.isDirectory()) continue;
    if (!expectedNames.has(entry.name)) {
      fs.rmSync(path.join(absolute, entry.name), {
        recursive: true,
        force: true,
      });
      console.log(`removed ${path.join(relativeRoot, entry.name)}`);
    }
  }
}

function removeSkillProjection(relativeRoot) {
  const absolute = path.join(root, relativeRoot);
  const markerPath = path.join(absolute, ".harness-generated");
  if (!fs.existsSync(markerPath)) return;
  if (!fs.readFileSync(markerPath, "utf8").includes(GENERATED_SKILL_MARKER))
    return;
  fs.rmSync(absolute, { recursive: true, force: true });
  console.log(`removed ${relativeRoot}`);
}

function syncSkills() {
  const skills = config.skills ?? [];
  const expected = new Set(skills.map((skill) => skill.name));

  if (adapterEnabled(config, "claude") && skills.length) {
    for (const skill of skills) copySkillTree(skill, ".claude/skills");
    write(".claude/skills/.harness-generated", skillMarkerText());
    reconcileSkillProjection(".claude/skills", expected);
  } else {
    removeSkillProjection(".claude/skills");
  }

  if (portableSkillsEnabled(config) && skills.length) {
    for (const skill of skills) copySkillTree(skill, ".agents/skills");
    write(".agents/skills/.harness-generated", skillMarkerText());
    reconcileSkillProjection(".agents/skills", expected);
  } else {
    removeSkillProjection(".agents/skills");
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
    write(target, claudeAgent(agent, instructions));
  }
  if (adapterEnabled(config, "copilot")) {
    const target = path.join(".github", "agents", `${agent.name}${extension}`);
    copilotAgents.add(target);
    write(target, copilotAgent(agent, instructions));
  }
  if (adapterEnabled(config, "cursor")) {
    const target = path.join(".cursor", "agents", `${agent.name}.md`);
    cursorAgents.add(target);
    write(target, cursorAgent(agent, instructions));
  }
}

reconcileAgentDirectory(path.join(".claude", "agents"), claudeAgents);
reconcileAgentDirectory(path.join(".github", "agents"), copilotAgents);
reconcileAgentDirectory(path.join(".cursor", "agents"), cursorAgents);

if (adapterEnabled(config, "claude")) {
  write(".claude/settings.json", claudeSettingsText(config));
} else {
  removeOwned(".claude/settings.json", '"_generated"');
}

if (adapterEnabled(config, "copilot")) {
  write(".github/copilot-instructions.md", copilotInstructions(config));
  write(".github/hooks/harness.json", copilotHooksText(config));
} else {
  removeOwned(
    ".github/copilot-instructions.md",
    "GENERATED FROM harness.config.json",
  );
  removeOwned(".github/hooks/harness.json", GENERATED_HOOK_MARKER);
}

if (adapterEnabled(config, "cursor")) {
  write(".cursor/rules/harness.mdc", cursorRulesText(config));
  write(".cursor/hooks.json", cursorHooksText(config));
} else {
  removeOwned(
    ".cursor/rules/harness.mdc",
    "GENERATED FROM harness.config.json",
  );
  removeOwned(".cursor/hooks.json", '"_generated"');
}

if (adapterEnabled(config, "codex")) {
  write("AGENTS.md", codexInstructionsText(config));
} else {
  removeOwned("AGENTS.md", "GENERATED FROM harness.config.json");
}

syncSkills();
syncRules("CLAUDE.md");
syncRules("README.md", { required: false });
