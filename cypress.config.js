const { defineConfig } = require("cypress");
const fs = require("node:fs");
const path = require("node:path");
const { plugin: cypressGrepPlugin } = require("@cypress/grep/plugin");
const webpackPreprocessor = require("@cypress/webpack-preprocessor");
const webpackConfig = require("./cypress/webpack.config.js");
const { mergeCypressEnv } = require("./cypress/configs/app/merge-env.js");

/**
 * Load environment-specific config from cypress/environments/cypress.env.{env}.json
 * Usage: cypress run --env configFile=qa
 */
function loadEnvConfig(configFile) {
  if (!configFile) return {};
  const filePath = path.resolve(
    __dirname,
    "cypress",
    "environments",
    `cypress.env.${configFile}.json`,
  );
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ Environment config not found: ${filePath}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

module.exports = defineConfig({
  // ── Global Config ──
  allowCypressEnv: false,
  // chromeWebSecurity: Cypress default (true). Do not disable unless a verified requirement
  // needs cross-origin frame access; document that requirement before changing.
  video: false,
  screenshotOnRunFailure: true,
  viewportWidth: 1920,
  viewportHeight: 1080,

  // ── Memory Management ──
  numTestsKeptInMemory: 5,

  // ── Timeouts ──
  defaultCommandTimeout: 10000,
  requestTimeout: 15000,
  responseTimeout: 15000,
  pageLoadTimeout: 30000,

  // ── Reporter ──
  // saveJson writes cypress/reports/html/index.json alongside the HTML. The HTML is for
  // humans; the JSON is the machine-readable run record that evidence and metrics are
  // computed from. Without it there is no input to normalize and coverage cannot be
  // measured. Passed through to mochawesome-report-generator, no extra dependency.
  reporter: "cypress-mochawesome-reporter",
  reporterOptions: {
    charts: true,
    reportPageTitle: "Automation Test Report",
    embeddedScreenshots: true,
    inlineAssets: true,
    saveAllAttempts: false,
    saveJson: true,
    reportDir: "cypress/reports/html",
  },

  e2e: {
    // Non-secret default target: the public Automation Exercise site. Overridable per environment
    // via cypress/environments/cypress.env.{env}.json or a CI-provided cypress.env.json baseUrl
    // (applied in setupNodeEvents below).
    baseUrl: "https://www.automationexercise.com",
    specPattern: "cypress/tests/**/*.cy.{js,ts}",
    supportFile: "cypress/support/e2e.js",
    fixturesFolder: "cypress/fixtures",
    downloadsFolder: "cypress/downloads",
    screenshotsFolder: "cypress/screenshots",
    videosFolder: "cypress/videos",

    setupNodeEvents(on, config) {
      // ── Mochawesome reporter ──
      require("cypress-mochawesome-reporter/plugin")(on);

      // ── Cypress Grep plugin ──
      cypressGrepPlugin(config);

      // ── Webpack preprocessor (path aliases) ──
      on(
        "file:preprocessor",
        webpackPreprocessor({ webpackOptions: webpackConfig }),
      );

      // ── Debug task ──
      on("task", {
        log(message) {
          console.log(message);
          return null;
        },
      });

      // ── Environment config merge ──
      // Tracked cypress/environments/*.json files are non-secret defaults.
      // config.env already holds cypress.env.json, CYPRESS_* vars, and --env;
      // those must win so a CI BASE_URL secret is not replaced by the public
      // URL committed in the environment file (see mergeCypressEnv).
      const envConfig = loadEnvConfig(config.env.configFile);
      config.env = mergeCypressEnv(envConfig, config.env);

      // ── Base URL from env ──
      // A selected env file or CI-written cypress.env.json (config.env.baseUrl) overrides the
      // non-secret default baseUrl set below. This keeps private environments configurable
      // through a BASE_URL secret while the public target works with no secret at all.
      if (config.env.baseUrl) {
        config.baseUrl = config.env.baseUrl;
      }

      return config;
    },
  },
});
