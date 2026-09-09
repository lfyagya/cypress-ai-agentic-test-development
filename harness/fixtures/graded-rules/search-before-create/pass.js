// FIXTURE — expected finding: none for search-before-create. Not a real config module.
//
// The same proposed `cart` config, after searching cypress/configs/** by value. The card and name
// hooks already have an owner, so they are reused rather than redeclared; only the genuinely new
// cart-specific value is declared here. One value, one owner — an application change stays one edit.
//
// This mirrors what BRANDS_UI already does in the live repo: its header states that the grid, card,
// and product-name hooks are owned by PRODUCTS_UI and are deliberately not redefined.

import { PRODUCTS_UI } from "@configs/ui/modules/products/products.ui.js";

export const CART_UI = Object.freeze({
  productCard: PRODUCTS_UI.productCard,
  productName: PRODUCTS_UI.productName,
  cartTable: "#cart_info_table",
});
