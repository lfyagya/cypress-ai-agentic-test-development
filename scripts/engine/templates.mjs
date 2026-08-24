/**
 * Single source of truth for every generated adapter.
 *
 * This file is byte-identical in the Cypress and Playwright boilerplates. Repository-specific
 * policy and role prompts come from harness.config.json and harness/agents/.
 */

import fs from "node:fs";
import path from "node:path";

export const RULES_START = "<!-- HARNESS:RULES:START -->";
export const RULES_END = "<!-- HARNESS:RULES:END -->";
export const GENERATED_AGENT_MARKER =
  "<!-- GENERATED FROM harness.config.json and harness/agents/. DO NOT EDIT. -->";
export const GENERATED_HOOK_MARKER = "HARNESS_GENERATED_FROM";
export const GENERATED_SKILL_MARKER = "HARNESS_GENERATED_SKILL_PROJECTION";
export const KNOWN_ROLES = ["INTAKE", "BUILD", "DIAGNOSE", "EVALUATE"];

const SUPPORTED_FRAMEWORKS = new Set(["cypress", "playwright"]);
const SUPPORTED_AGENT_EXTENSIONS = new Set([".md", ".agent.md"]);
const SUPPORTED_ENFORCEMENT = new Set(["Hook + CI", "CI", "QA gate"]);
// Every AI tool the harness knows how to project into. A profile enables a subset; sync generates
// files for the enabled ones and removes the rest. Adding a tool here is the only place the set grows.
const KNOWN_ADAPTERS = ["claude", "copilot", "cursor", "codex"];
const COPILOT_TOOL_ALIASES = {
  Agent: "agent",
  Bash: "execute",
  Edit: "edit",
  Glob: "search",
  Grep: "search",
  PowerShell: "execute",
  Read: "read",
  Task: "agent",
  TodoWrite: "todo",
  WebFetch: "web",
  WebSearch: "web",
  Write: "edit",
};

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid harness.config.json: ${message}`);
}

function validateConfig(config) {
  requireValue(config?.version === 1, "version must be 1");
  requireValue(
    SUPPORTED_FRAMEWORKS.has(config.framework),
    "framework must be cypress or playwright",
  );
  requireValue(
    config.adapters && typeof config.adapters === "object",
    "adapters must be an object",
  );
  const adapterKeys = Object.keys(config.adapters);
  requireValue(
    adapterKeys.length > 0,
    "adapters must declare at least one tool",
  );
  for (const adapter of adapterKeys) {
    requireValue(
      KNOWN_ADAPTERS.includes(adapter),
      `unknown adapter "${adapter}" — known: ${KNOWN_ADAPTERS.join(", ")}`,
    );
    requireValue(
      typeof config.adapters[adapter]?.enabled === "boolean",
      `adapters.${adapter}.enabled must be boolean`,
    );
  }

  const extension = config.agentFileExtension ?? ".agent.md";
  requireValue(
    SUPPORTED_AGENT_EXTENSIONS.has(extension),
    "agentFileExtension must be .md or .agent.md",
  );
  requireValue(
    Array.isArray(config.rules) && config.rules.length > 0,
    "rules must not be empty",
  );
  requireValue(
    Array.isArray(config.agents) && config.agents.length > 0,
    "agents must not be empty",
  );
  requireValue(
    Number.isInteger(config.loops?.gateRepairLimit) &&
      config.loops.gateRepairLimit >= 1 &&
      config.loops.gateRepairLimit <= 8,
    "loops.gateRepairLimit must be an integer from 1 to 8",
  );
  requireValue(
    typeof config.qaFoundations === "string" && config.qaFoundations.length > 0,
    "qaFoundations must be a path",
  );

  const ruleIds = new Set();
  for (const rule of config.rules) {
    requireValue(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rule.id),
      `invalid rule id: ${rule.id}`,
    );
    requireValue(!ruleIds.has(rule.id), `duplicate rule id: ${rule.id}`);
    requireValue(
      SUPPORTED_ENFORCEMENT.has(rule.enforcement),
      `${rule.id}.enforcement must be Hook + CI, CI, or QA gate`,
    );
    ruleIds.add(rule.id);
  }

  const agentNames = new Set();
  for (const agent of config.agents) {
    requireValue(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent.name),
      `invalid agent name: ${agent.name}`,
    );
    requireValue(
      !agentNames.has(agent.name),
      `duplicate agent name: ${agent.name}`,
    );
    requireValue(
      Array.isArray(agent.tools) && agent.tools.length > 0,
      `${agent.name}.tools must be a non-empty array`,
    );
    agentNames.add(agent.name);
  }

  // skills[] is optional. When present, each entry points at a pinned tree under harness/skills/
  // and declares which lifecycle roles must load it. Sync projects those trees to .claude/skills
  // and .agents/skills only.
  if (config.skills !== undefined) {
    requireValue(
      Array.isArray(config.skills),
      "skills must be an array when present",
    );
    const skillNames = new Set();
    const agentRoles = new Set(config.agents.map((agent) => agent.role));
    for (const skill of config.skills) {
      requireValue(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name),
        `invalid skill name: ${skill.name}`,
      );
      requireValue(
        !skillNames.has(skill.name),
        `duplicate skill name: ${skill.name}`,
      );
      requireValue(
        typeof skill.description === "string" && skill.description.length > 0,
        `${skill.name}.description must be a non-empty string`,
      );
      requireValue(
        typeof skill.source === "string" &&
          skill.source.startsWith("harness/skills/"),
        `${skill.name}.source must be a path under harness/skills/`,
      );
      requireValue(
        typeof skill.version === "string" && skill.version.length > 0,
        `${skill.name}.version must be a non-empty string`,
      );
      requireValue(
        Array.isArray(skill.roles) && skill.roles.length > 0,
        `${skill.name}.roles must be a non-empty array`,
      );
      for (const role of skill.roles) {
        requireValue(
          KNOWN_ROLES.includes(role),
          `${skill.name}.roles has unknown role: ${role}`,
        );
        requireValue(
          agentRoles.has(role),
          `${skill.name}.roles includes ${role} but no agent has that role`,
        );
      }
      skillNames.add(skill.name);
    }
  }

  return config;
}

export function readConfig(repoRoot) {
  const configPath = path.join(repoRoot, "harness.config.json");
  return validateConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

export function adapterEnabled(config, adapter) {
  return config.adapters?.[adapter]?.enabled === true;
}

function generatedBanner() {
  return "<!-- GENERATED FROM harness.config.json — DO NOT EDIT. Change harness.config.json, then run npm run harness:sync. npm run harness:check fails on drift. -->";
}

/**
 * Resolve Claude hooks from the trusted project root exposed by the client. cwd is only the
 * fallback for clients that do not provide a project-root variable.
 */
function hookCommand(script) {
  const loader =
    "const p=require('node:path'),u=require('node:url');" +
    "const r=process.env.CURSOR_PROJECT_DIR||process.env.CLAUDE_PROJECT_DIR||process.cwd();" +
    "import(u.pathToFileURL(p.join(r,'.claude','hooks',process.argv[1])).href)";
  return { type: "command", command: `node -e "${loader}" "${script}"` };
}

const group = (scripts, matcher) => [
  { ...(matcher ? { matcher } : {}), hooks: scripts.map(hookCommand) },
];

export function claudeSettings(config) {
  const h = config.hooks ?? {};
  const hooks = {};
  if (h.sessionStart?.length) hooks.SessionStart = group(h.sessionStart);
  if (h.prompt?.length) hooks.UserPromptSubmit = group(h.prompt);
  if (h.preWrite?.length) hooks.PreToolUse = group(h.preWrite, "Edit|Write");
  if (h.postWrite?.length) hooks.PostToolUse = group(h.postWrite, "Edit|Write");
  if (h.stop?.length) hooks.Stop = group(h.stop);

  return {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    _generated:
      "From harness.config.json by scripts/engine/sync.mjs. Do not edit.",
    hooks,
    ...config.context,
    permissions: config.permissions,
    ...(config.env ? { env: config.env } : {}),
  };
}

export const claudeSettingsText = (config) =>
  `${JSON.stringify(claudeSettings(config), null, 2)}\n`;

function copilotHook(script) {
  return {
    type: "command",
    command: `node .claude/hooks/${script}`,
    cwd: ".",
    timeoutSec: 30,
    env: { [GENERATED_HOOK_MARKER]: "harness.config.json" },
  };
}

export function copilotHooks(config) {
  const h = config.hooks ?? {};
  const hooks = {};
  // Copilot event names: userPromptSubmitted / PreToolUse / PostToolUse / agentStop.
  // PascalCase PreToolUse uses Claude matcher semantics; exit code 2 denies the tool call.
  if (h.prompt?.length) {
    hooks.userPromptSubmitted = h.prompt.map((script) => copilotHook(script));
  }
  if (h.preWrite?.length) {
    hooks.PreToolUse = h.preWrite.map((script) => ({
      matcher: "Edit|Write",
      ...copilotHook(script),
    }));
  }
  if (h.postWrite?.length) {
    hooks.PostToolUse = h.postWrite.map((script) => ({
      matcher: "Edit|Write",
      ...copilotHook(script),
    }));
  }
  if (h.stop?.length) {
    hooks.agentStop = h.stop.map((script) => copilotHook(script));
  }
  return { version: 1, hooks };
}

export const copilotHooksText = (config) =>
  `${JSON.stringify(copilotHooks(config), null, 2)}\n`;

export function rulesBlock(config) {
  const width = Math.max(...config.rules.map((rule) => rule.never.length));
  const lines = config.rules.map(
    (rule) => `NEVER  →  ${rule.never.padEnd(width)}   ${rule.instead}`,
  );
  return [
    RULES_START,
    "<!-- Generated from harness.config.json — run `npm run harness:sync`. Do not edit by hand. -->",
    "",
    "```text",
    ...lines,
    "```",
    "",
    "| Rule | Why it exists | Enforcement |",
    "|---|---|---|",
    ...config.rules.map(
      (rule) => `| \`${rule.id}\` | ${rule.why} | ${rule.enforcement} |`,
    ),
    "",
    RULES_END,
  ].join("\n");
}

// Shared building blocks so every text projection (Copilot, Cursor, Codex) renders the same rule and
// roster lines from the one config. Kept byte-identical to the original Copilot strings.
function ruleBullets(config) {
  return config.rules
    .map(
      (rule) =>
        `- **${rule.id}** (${rule.enforcement}) — never ${rule.never}; use ${rule.instead}. ${rule.why}`,
    )
    .join("\n");
}

function agentBullets(config) {
  return config.agents
    .map((agent) => `- \`${agent.name}\` (${agent.role}) — ${agent.when}`)
    .join("\n");
}

function readOnlyRationale(config) {
  return (
    config.agents.find((agent) => agent.readOnlyRationale)?.readOnlyRationale ??
    ""
  );
}

function whereThingsLive(config) {
  const project = config.project;
  const commandLabel = config.framework === "cypress" ? "Commands" : "Helpers";
  return [
    "| Layer | Path |",
    "|---|---|",
    `| Config | \`${project.configRoot}\` |`,
    `| ${commandLabel} | \`${project.commandRoot}\` |`,
    `| Tests | \`${project.specGlob}\` |`,
  ].join("\n");
}

export function copilotInstructions(config) {
  const project = config.project;
  return `${generatedBanner()}

# GitHub Copilot Instructions — ${project.name}

Architecture: **${project.architecture}**. Read \`CLAUDE.md\` for the full framework contract and
\`docs/application-intelligence/<module>/module-context.md\` for what the application does.

## Non-negotiable rules

${ruleBullets(config)}

Edit and Write tool calls are checked by the generated repository hooks. CI rescans repository
changes as the final backstop; shell commands are not represented as Edit or Write tool calls.

## Agents

${agentBullets(config)}

${readOnlyRationale(config)}

## Where things live

${whereThingsLive(config)}
`;
}

// Cursor reads project rules from .cursor/rules/*.mdc. `alwaysApply: true` puts the harness contract
// in every chat. Write-time refusal is `.cursor/hooks.json` → preToolUse (same scripts as Claude).
export function cursorRules(config) {
  const project = config.project;
  const frontmatter = [
    "---",
    `description: ${project.name} — Cypress harness contract: non-negotiable rules, architecture, and agent roster`,
    "alwaysApply: true",
    "---",
  ].join("\n");
  const body = `${generatedBanner()}

# ${project.name} — Cypress Harness (Cursor rules)

Architecture: **${project.architecture}**. Read \`CLAUDE.md\` for the full framework contract and
\`docs/application-intelligence/<module>/module-context.md\` for what the application does.

## Non-negotiable rules

${ruleBullets(config)}

\`preToolUse\` in \`.cursor/hooks.json\` refuses violating Write/StrReplace calls (exit code 2).
Human edits and any miss still hit \`npm run verify\` / pre-push / CI — see
\`docs/architecture/cross-tool-configuration.md\`.

## Agent roster

${agentBullets(config)}

${readOnlyRationale(config)}

## Where things live

${whereThingsLive(config)}
`;
  return `${frontmatter}\n\n${body}`;
}

export const cursorRulesText = (config) => cursorRules(config);

// Codex reads AGENTS.md from the repo root before starting work. Codex has no hook system, so its
// enforcement is the universal floor (verify + pre-push + CI), not a write-time block.
export function codexInstructions(config) {
  const project = config.project;
  return `${generatedBanner()}

# AGENTS.md — ${project.name}

Codex reads this file before starting work. Architecture: **${project.architecture}**. The full
framework contract is \`CLAUDE.md\`; application behavior is
\`docs/application-intelligence/<module>/module-context.md\`.

## Non-negotiable rules

${ruleBullets(config)}

Codex has no write-time hook, so these rules are guidance. The enforcing gate is \`npm run verify\`
(local + pre-push) and CI — see \`docs/architecture/cross-tool-configuration.md\`.

## Agent roster

${agentBullets(config)}

${readOnlyRationale(config)}

## Where things live

${whereThingsLive(config)}
`;
}

export const codexInstructionsText = (config) => codexInstructions(config);

export function skillsForRole(config, role) {
  return (config.skills ?? []).filter((skill) => skill.roles.includes(role));
}

function skillsSection(config, agent) {
  const skills = skillsForRole(config, agent.role);
  if (skills.length === 0) return "";
  const lines = skills.map(
    (skill) =>
      `- \`${skill.name}\` (${skill.source}) — ${skill.description} Invoke with \`/${skill.name}\` or let the tool auto-load it.`,
  );
  return `

## Required Cypress skills for this role

The skill knows *how* to work with Cypress. This agent still owns *when*, *why*, and harness
constraints (requirements, config → commands → tests, gate). Load and follow:

${lines.join("\n")}
`;
}

export function agentInstructions(repoRoot, config, agent) {
  const source = agent.instructions ?? `harness/agents/${agent.name}.md`;
  const agentRoot = path.resolve(repoRoot, "harness", "agents");
  const resolved = path.resolve(repoRoot, source);
  const relative = path.relative(agentRoot, resolved);
  requireValue(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${agent.name}.instructions must resolve inside harness/agents`,
  );
  const foundationsPath = path.resolve(repoRoot, config.qaFoundations);
  const foundationsRelative = path.relative(
    path.resolve(repoRoot, "harness"),
    foundationsPath,
  );
  requireValue(
    foundationsRelative &&
      !foundationsRelative.startsWith("..") &&
      !path.isAbsolute(foundationsRelative),
    "qaFoundations must resolve inside harness/",
  );
  const foundations = fs
    .readFileSync(foundationsPath, "utf8")
    .replace(/\r\n/g, "\n")
    .trim();
  const body = fs
    .readFileSync(resolved, "utf8")
    .replace(/\r\n/g, "\n")
    .trim()
    .replaceAll("{{gateRepairLimit}}", String(config.loops.gateRepairLimit))
    .replaceAll("{{qaFoundations}}", foundations);
  return `${body}${skillsSection(config, agent)}`;
}

export function claudeAgent(agent, instructions) {
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
    ...(agent.model ? [`model: ${agent.model}`] : []),
    ...(agent.permissionMode
      ? [`permissionMode: ${agent.permissionMode}`]
      : []),
    "tools:",
    ...agent.tools.map((tool) => `  - ${tool}`),
    "---",
  ];
  return `${frontmatter.join("\n")}\n\n${GENERATED_AGENT_MARKER}\n\n${instructions}\n`;
}

// Cursor subagents: .cursor/agents/*.md with name/description/model/readonly frontmatter.
// EVALUATE is readonly so the gate cannot edit. Write refusal is project preToolUse, not agent YAML.
export function cursorAgent(agent, instructions) {
  const readOnly =
    agent.permissionMode === "plan" ||
    agent.role === "EVALUATE" ||
    !agent.tools.some((tool) => ["Write", "Edit", "Bash"].includes(tool));
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
    "model: inherit",
    ...(readOnly ? ["readonly: true"] : []),
    "---",
  ];
  return `${frontmatter.join("\n")}\n\n${GENERATED_AGENT_MARKER}\n\n${instructions}\n`;
}

export function copilotTools(agent) {
  return [
    ...new Set(
      agent.tools.map((tool) => COPILOT_TOOL_ALIASES[tool]).filter(Boolean),
    ),
  ];
}

export function copilotAgent(agent, instructions) {
  const tools = copilotTools(agent);
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
    `tools: ${JSON.stringify(tools)}`,
    "---",
  ];
  return `${frontmatter.join("\n")}\n\n${GENERATED_AGENT_MARKER}\n\n${instructions}\n`;
}

// Cursor: preToolUse exit 2 denies Write/StrReplace; afterFileEdit still runs post-write scan.
export function cursorHooks(config) {
  const h = config.hooks ?? {};
  const hooks = {};
  if (h.prompt?.length) {
    hooks.beforeSubmitPrompt = h.prompt.map((script) => ({
      command: `node .claude/hooks/${script}`,
    }));
  }
  if (h.preWrite?.length) {
    hooks.preToolUse = h.preWrite.map((script) => ({
      command: `node .claude/hooks/${script}`,
      matcher: "Write|StrReplace",
    }));
  }
  if (h.postWrite?.length) {
    hooks.afterFileEdit = h.postWrite.map((script) => ({
      command: `node .claude/hooks/${script}`,
    }));
  }
  if (h.stop?.length) {
    hooks.stop = h.stop.map((script) => ({
      command: `node .claude/hooks/${script}`,
    }));
  }
  return {
    version: 1,
    _generated:
      "From harness.config.json by scripts/engine/sync.mjs. preToolUse exit 2 refuses a violating write.",
    hooks,
  };
}

export const cursorHooksText = (config) =>
  `${JSON.stringify(cursorHooks(config), null, 2)}\n`;

/** Whether the portable .agents/skills tree should be projected. */
export function portableSkillsEnabled(config) {
  return ["copilot", "cursor", "codex"].some((adapter) =>
    adapterEnabled(config, adapter),
  );
}

export function skillMarkerText() {
  return `${GENERATED_SKILL_MARKER}=harness.config.json\n`;
}

export function listSkillFiles(repoRoot, skillSource) {
  const root = path.resolve(repoRoot, skillSource);
  requireValue(
    fs.existsSync(root) && fs.statSync(root).isDirectory(),
    `skill source missing: ${skillSource}`,
  );
  const skillRoot = path.resolve(repoRoot, "harness", "skills");
  const relative = path.relative(skillRoot, root);
  requireValue(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `skill source must resolve inside harness/skills: ${skillSource}`,
  );
  const files = [];
  const walk = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else files.push(rel.replaceAll("\\", "/"));
    }
  };
  walk(root);
  return files.sort();
}

export function injectRules(existingText, config) {
  const start = existingText.indexOf(RULES_START);
  const end = existingText.indexOf(RULES_END);
  if (start === -1 || end === -1 || end < start) return null;
  if (existingText.indexOf(RULES_START, start + RULES_START.length) !== -1)
    return null;
  if (existingText.indexOf(RULES_END, end + RULES_END.length) !== -1)
    return null;
  return (
    existingText.slice(0, start) +
    rulesBlock(config) +
    existingText.slice(end + RULES_END.length)
  );
}
