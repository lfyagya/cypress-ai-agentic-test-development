// FIXTURE — expected finding: search-before-create. Not a real config module.
//
// A proposed new UI config for a `cart` module. `.product-image-wrapper` and `.productinfo p` are
// already owned by PRODUCTS_UI in cypress/configs/ui/modules/products/products.ui.js. Redeclaring
// them creates a second owner for one value: the next application change requires finding and
// editing both, and whoever edits one will not know the other exists.
//
// This is what a filename check misses. Nothing called `cart.ui.js` existed, so "search first"
// looked satisfied — but the *values* already had a home. Search by value, not by filename.
//
// Unlike the other two graded rules, this one is not a score deduction. The gate's Phase 1 lists
// "No redundant config, command, or spec that duplicates existing ownership" with
// **Verdict if failed: BLOCK**.

export const CART_UI = Object.freeze({
  productCard: ".product-image-wrapper",
  productName: ".productinfo p",
  cartTable: "#cart_info_table",
});
