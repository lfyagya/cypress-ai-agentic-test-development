// FIXTURE — expected finding: none for narrow-before-index. Not a real spec.
// @no-ensureAuthenticated — fixture models a public flow; no session is required.
//
// Same behaviour, disambiguated by content instead of position. `cy.contains(selector, text)`
// narrows to the card that actually holds the product, and `.within()` scopes the click to that
// card's subtree. Reordering the catalog cannot silently retarget this.

const FIXTURE_UI = Object.freeze({
  productCard: ".fixture-product-card",
  addToCart: ".fixture-add-to-cart",
});

describe("fixture · narrow-before-index", () => {
  it(
    "[FIXTURE-002] visitor adds the Blue Top to the cart",
    { tags: ["@FIXTURE-002", "@regression", "@P1", "@e2e"] },
    () => {
      cy.contains(FIXTURE_UI.productCard, "Blue Top").within(() => {
        cy.get(FIXTURE_UI.addToCart).click();
      });
      cy.contains(FIXTURE_UI.productCard, "Blue Top").should("be.visible");
    },
  );
});
