/**
 * @fileoverview Table assertion commands.
 *
 * cy.assertTableHasRows(tableSelector, minCount)              — assert row count >= n.
 * cy.assertTableEmpty(tableSelector, emptyStateSelector)      — assert empty state visible.
 * cy.assertTableRowContains(rowSelector, columnIndex, text)   — assert a cell contains text.
 * cy.getTableRowByText(tableSelector, text)                   — get row containing text.
 * cy.assertTableColumnSorted(colHeaderSelector, direction)    — assert aria-sort (asc|desc).
 */
import { ariaSortForDirection } from "./table.engine.js";

Cypress.Commands.add("assertTableHasRows", (tableSelector, minCount = 1) => {
  cy.get(tableSelector)
    .find('tr, [data-cy$="-table-row"]')
    .should("have.length.gte", minCount);
});

Cypress.Commands.add(
  "assertTableEmpty",
  (tableSelector, emptyStateSelector) => {
    cy.get(tableSelector)
      .find('tr, [data-cy$="-table-row"]')
      .should("have.length", 0);
    cy.get(emptyStateSelector).should("be.visible");
  },
);

Cypress.Commands.add(
  "assertTableRowContains",
  (rowSelector, columnIndex, text) => {
    cy.get(rowSelector).find("td").eq(columnIndex).should("contain.text", text);
  },
);

Cypress.Commands.add("getTableRowByText", (tableSelector, text) => {
  return cy.get(tableSelector).contains('tr, [data-cy$="-table-row"]', text);
});

Cypress.Commands.add(
  "assertTableColumnSorted",
  (colHeaderSelector, direction) => {
    cy.get(colHeaderSelector).should(
      "have.attr",
      "aria-sort",
      ariaSortForDirection(direction),
    );
  },
);
