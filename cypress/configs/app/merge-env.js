/**
 * Merge a tracked environment file into Cypress's already-resolved `config.env`.
 *
 * `resolvedEnv` already contains `cypress.env.json`, `CYPRESS_*` variables, and
 * `--env`. Those must win: CI writes `BASE_URL` (and credentials) into
 * `cypress.env.json` specifically so a private target can override the public
 * URL committed in `cypress/environments/cypress.env.{dev|qa|prod}.json`.
 * Spreading the file last silently replaced that secret and sent tests (and any
 * injected credentials) at the public site.
 */
function mergeCypressEnv(fileEnv = {}, resolvedEnv = {}) {
  return { ...fileEnv, ...resolvedEnv };
}

module.exports = { mergeCypressEnv };
