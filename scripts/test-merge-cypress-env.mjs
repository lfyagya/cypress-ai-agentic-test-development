import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { mergeCypressEnv } = require("../cypress/configs/app/merge-env.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const qaFile = JSON.parse(
  fs.readFileSync(
    path.join(root, "cypress", "environments", "cypress.env.qa.json"),
    "utf8",
  ),
);

// Concrete CI path: workflow writes BASE_URL + credentials to cypress.env.json,
// then starts Cypress with CYPRESS_configFile=qa. The qa file also has baseUrl
// (the public site). Secrets must survive the merge.
const fromCi = {
  baseUrl: "https://staging.internal.example",
  username: "staging-user",
  password: "staging-secret",
  authUrl: "/api/auth/login",
  configFile: "qa",
};

const merged = mergeCypressEnv(qaFile, fromCi);
assert.equal(
  merged.baseUrl,
  "https://staging.internal.example",
  "CI BASE_URL must not be replaced by the tracked environment file",
);
assert.equal(merged.username, "staging-user");
assert.equal(merged.configFile, "qa");

const resolved = { baseUrl: qaFile.baseUrl };
if (merged.baseUrl) resolved.baseUrl = merged.baseUrl;
assert.equal(
  resolved.baseUrl,
  "https://staging.internal.example",
  "setupNodeEvents must copy the surviving env.baseUrl onto config.baseUrl",
);

const clobbered = { ...fromCi, ...qaFile };
assert.equal(
  clobbered.baseUrl,
  qaFile.baseUrl,
  "sanity: spreading the environment file last is the failure mode under test",
);

const fileOnly = mergeCypressEnv(qaFile, { configFile: "qa" });
assert.equal(
  fileOnly.baseUrl,
  qaFile.baseUrl,
  "without a CI override the tracked environment URL is used",
);

const configJs = fs.readFileSync(path.join(root, "cypress.config.js"), "utf8");
assert.match(
  configJs,
  /mergeCypressEnv\(\s*envConfig,\s*config\.env\s*\)/,
  "cypress.config.js must apply the file first so resolved env wins",
);
assert.doesNotMatch(
  configJs,
  /config\.env\s*=\s*\{\s*\.\.\.config\.env,\s*\.\.\.envConfig\s*\}/,
  "spreading the environment file last reintroduces the BASE_URL clobber",
);

console.log(
  "[cypress:env-merge] CI BASE_URL override wins over tracked environment files",
);
