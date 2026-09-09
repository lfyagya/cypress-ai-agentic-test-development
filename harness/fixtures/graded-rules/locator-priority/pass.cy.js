// FIXTURE — expected finding: none for locator-priority. Not a real spec.
// @no-ensureAuthenticated — fixture models a public flow; no session is required.
//
// Same behaviour as fail.cy.js, expressed at locator contract levels 1-2: the field by its label,
// the button by its accessible role and name. Survives a DOM refactor that the class-based version
// does not, and doubles as accessibility pressure on the application.

describe("fixture · locator-priority", () => {
  it(
    "[FIXTURE-001] visitor searches the catalog",
    { tags: ["@FIXTURE-001", "@regression", "@P1", "@e2e"] },
    () => {
      cy.findByLabelText("Search Product").type("dress");
      cy.findByRole("button", { name: "Search" }).click();
      cy.findByRole("heading", { name: "Searched Products" }).should(
        "be.visible",
      );
    },
  );
});
