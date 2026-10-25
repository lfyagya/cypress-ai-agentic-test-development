/**
 * @fileoverview Core API barrel export.
 * Import everything from here: import { HTTP_STATUS, isSuccess } from '@core/api';
 */

export {
  HTTP_STATUS,
  isSuccess,
  isClientError,
  isServerError,
  getStatusCategory,
  getStatusName,
} from "./status-codes";
export {
  registerIntercept,
  registerAllIntercepts,
  waitForAPI,
  waitForAPIs,
  makeRequest,
  stubResponse,
  assertResponseTime,
  assertResponseFields,
  WRITE_METHODS,
  isSmokeSpec,
  assertSmokeReadOnlyRequest,
} from "./api.engine";

// Side-effect imports — register Cypress commands
import "./api.commands";
import "./schema.commands";
