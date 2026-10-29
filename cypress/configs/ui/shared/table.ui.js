/**
 * Shared table locators.
 *
 * Data rows live in `tbody`. A bare `tr` also matches `<thead>`, so
 * `assertTableHasRows(table, 1)` used to pass on an empty table that still
 * rendered a header row.
 */
export const TABLE_UI = Object.freeze({
  dataRow: "tbody tr, [data-cy$='-table-row']",
  cell: "td",
});
