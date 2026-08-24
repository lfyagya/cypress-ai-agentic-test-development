/**
 * Shared Cypress rule scanner used by both pre-validate and post-validate hooks.
 *
 * This is now the wiring point, not the implementation. The scan mechanism lives in the
 * shared engine (`rule-engine.mjs`, L1); the Cypress patterns live in
 * `cypress.patterns.mjs` (L2). Add or change a rule there — this file only composes them
 * and preserves the export surface the hooks and engine self-tests already use.
 */

import {
  extractBalancedObject,
  isAllowedLiteral,
  lineNumberForIndex,
  loadAllowlist,
  loadRuleMessages,
  makeExtractToolChange,
  makeScanner,
  scanForRegex,
  toPosix,
} from "./rule-engine.mjs";
import {
  EXTENSION_PATTERNS,
  WRITE_TOOLS,
  rules,
  targetFileRe,
} from "./cypress.patterns.mjs";

export const extractToolChange = makeExtractToolChange(WRITE_TOOLS);
export const scanContent = makeScanner({ targetFileRe, rules });

export {
  EXTENSION_PATTERNS,
  extractBalancedObject,
  isAllowedLiteral,
  lineNumberForIndex,
  loadAllowlist,
  loadRuleMessages,
  scanForRegex,
  toPosix,
};
