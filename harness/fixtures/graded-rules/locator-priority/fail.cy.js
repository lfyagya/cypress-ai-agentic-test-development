// FIXTURE — expected finding: locator-priority. Not a real spec; not collected by Cypress.
// @no-ensureAuthenticated — fixture models a public flow; no session is required.
//
// The button carries an accessible role and an accessible name, so locator contract level 1
// (cy.findByRole) is available. This reaches for a CSS class instead — level 5 with no stated
// reason. Expected deduction: "Structural locator where a semantic one exists" (-10).
//
// Note what this fixture must NOT do: put the selector in the file as a literal. That would trip
// the blocking `no-hardcoded-selector` hook, the write would be refused, and the QA gate would
// never see it. The constant below is what makes this violation *reachable* by the gate.

const FIXTURE_UI = Object.freeze({
  searchButton: ".search-form button.btn-primary",
  searchInput: "#search_product",
});

describe("fixture · locator-priority", () => {
  it(
    "[FIXTURE-001] visitor searches the catalog",
    { tags: ["@FIXTURE-001", "@regression", "@P1", "@e2e"] },
    () => {
      cy.get(FIXTURE_UI.searchInput).type("dress");
      cy.get(FIXTURE_UI.searchButton).click();
      cy.get(FIXTURE_UI.searchButton).should("be.visible");
    },
  );
});
