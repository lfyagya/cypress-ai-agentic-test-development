/**
 * Wiring for the engine's `source` adapter: the L1 scan mechanism over the source rule table. Same
 * export surface as an adapter's shared-rules.mjs, so the rules checker and the hooks treat a dev lane
 * exactly like a test lane.
 */
import { makeExtractToolChange, makeScanner } from "./rule-engine.mjs";
import { rules, targetFileRe } from "./source.patterns.mjs";

export const extractToolChange = makeExtractToolChange();
export const scanContent = makeScanner({ targetFileRe, rules });
