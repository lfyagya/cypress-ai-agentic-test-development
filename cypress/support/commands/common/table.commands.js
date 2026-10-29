/**
 * @fileoverview Table assertion commands.
 *
 * cy.assertTableHasRows(tableSelector, minCount)              — assert body row count >= n.
 * cy.assertTableEmpty(tableSelector, emptyStateSelector)      — assert empty state visible.
 * cy.assertTableRowContains(rowSelector, columnIndex, text)   — assert a cell contains text.
 * cy.getTableRowByText(tableSelector, text)                   — get body row containing text.
 * cy.assertTableColumnSorted(colHeaderSelector, direction)    — assert sort arrow direction.
 */
import { TABLE_UI } from "@configs/ui/shared/table.ui.js";

Cypress.Commands.add("assertTableHasRows", (tableSelector, minCount = 1) => {
  cy.get(tableSelector)
    .find(TABLE_UI.dataRow)
    .should("have.length.gte", minCount);
});

Cypress.Commands.add(
  "assertTableEmpty",
  (tableSelector, emptyStateSelector) => {
    cy.get(tableSelector).find(TABLE_UI.dataRow).should("have.length", 0);
    cy.get(emptyStateSelector).should("be.visible");
  },
);

Cypress.Commands.add(
  "assertTableRowContains",
  (rowSelector, columnIndex, text) => {
    cy.get(rowSelector)
      .find(TABLE_UI.cell)
      .eq(columnIndex)
      .should("contain.text", text);
  },
);

Cypress.Commands.add("getTableRowByText", (tableSelector, text) => {
  return cy.get(tableSelector).contains(TABLE_UI.dataRow, text);
});

Cypress.Commands.add(
  "assertTableColumnSorted",
  (colHeaderSelector, direction) => {
    const ariaValue = direction === "asc" ? "ascending" : "descending";
    cy.get(colHeaderSelector).should("have.attr", "aria-sort", ariaValue);
  },
);
