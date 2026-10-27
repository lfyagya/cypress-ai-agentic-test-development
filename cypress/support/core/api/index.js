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
  requestUrlFromEndpoint,
  stubResponse,
  assertResponseTime,
  assertResponseFields,
} from "./api.engine";

// Side-effect imports — register Cypress commands
import "./api.commands";
import "./schema.commands";
