// FIXTURE — expected finding: narrow-before-index. Not a real spec.
// @no-ensureAuthenticated — fixture models a public flow; no session is required.
//
// `.first()` picks whatever the DOM happens to put first. When the catalog reorders, this targets a
// different product and still passes — a green test asserting the wrong thing, which is the worst
// failure mode. The card content can identify the intended element, so a filter was available.
// Expected deduction: "Index used where a filter would disambiguate" (-10).
//
// No blocking rule fires here: `.first()` is legal JavaScript and the selector comes from a
// constant. That is precisely why this rule is graded rather than hooked.

const FIXTURE_UI = Object.freeze({
  productCard: ".fixture-product-card",
  addToCart: ".fixture-add-to-cart",
});

describe("fixture · narrow-before-index", () => {
  it(
    "[FIXTURE-002] visitor adds the Blue Top to the cart",
    { tags: ["@FIXTURE-002", "@regression", "@P1", "@e2e"] },
    () => {
      cy.get(FIXTURE_UI.productCard).first().find(FIXTURE_UI.addToCart).click();
      cy.get(FIXTURE_UI.productCard).eq(0).should("be.visible");
    },
  );
});
