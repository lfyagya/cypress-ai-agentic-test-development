# Products Module Context

Status: `ACTIVE` (catalog API and products listing UI)

## Identity and evidence

| Field             | Value                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Module            | `products`                                                                                                      |
| Business owner    | Yagya Bhatta — pending formal confirmation                                                                      |
| Source references | Published API list; live `GET /api/productsList`; live unauthenticated `GET /products`; owner-approved UI slice |
| Last verified     | `2026-08-13`                                                                                                    |

## Business intent

Anonymous visitors must be able to retrieve and view a non-empty product catalog, and search it by
term. The API smoke detects transport/payload/shape failures, the UI smoke detects a missing heading
or empty non-visible card grid, and the e2e search regression detects a broken search endpoint.
Filters, product detail, cart, and authentication remain out of scope.

## Actors and safety

| Actor             | Allowed behavior                                                                                                | Preconditions                   | Denied behavior       |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------- |
| Anonymous visitor | Read `GET /api/productsList`; open `/products`; view product cards; `POST /api/searchProduct` (read-only query) | Public site reachable; no login | All mutation in smoke |

All three active requirements are read-only and create no test data, so isolation and cleanup are not
applicable. Credentials, PII, and payment data remain forbidden.

## Verified states

| Requirement       | Action                    | Expected state   | Observable evidence                                                                                      |
| ----------------- | ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `AE-PRODUCTS-001` | `GET /api/productsList`   | Catalog returned | HTTP `200`; payload `responseCode: 200`; non-empty `products[]`; every product has `id`, `name`, `price` |
| `AE-PRODUCTS-002` | Open `/products`          | Listing shown    | `All Products` heading; visible listing region; at least one card and visible non-empty product name     |
| `AE-PRODUCTS-003` | `POST /api/searchProduct` | Matches returned | HTTP `200`; payload `responseCode: 200`; non-empty `products[]`; every product has `id`, `name`, `price` |

### API catalog {#api-catalog}

- Published endpoint: `GET https://automationexercise.com/api/productsList`.
- Verified response: HTTP `200` with `{ "responseCode": 200, "products": [...] }`.
- `PRODUCTS_API.LIST` owns the method, endpoint, alias, and expected status in
  `cypress/configs/api/modules/products/products.api.js`.
- Some non-browser clients receive HTTP `403`; the Cypress request path was verified live.

### API search {#api-search}

- Published endpoint: `POST https://automationexercise.com/api/searchProduct` ("API 5: POST To Search
  Product" in the public api_list), verified live 2026-08-13.
- Requires a url-encoded `search_product` form field. A JSON body returns `responseCode: 400`
  ("search_product parameter is missing"); the form body returns HTTP `200` with
  `{ "responseCode": 200, "products": [...] }`.
- Read-only: the search queries the catalog and mutates no shared state. It lives in the **e2e** tier
  because it is a POST, and the smoke tier forbids POST/PUT/PATCH/DELETE — this is the concrete
  smoke-read-only vs e2e-mutation-allowed boundary.
- `PRODUCTS_API.SEARCH` owns the method, endpoint, alias, and expected status in
  `cypress/configs/api/modules/products/products.api.js`.

### Listing grid {#listing-grid}

- Route `/products` and title `Automation Exercise - All Products` verified unauthenticated.
- Presentation is a card grid, not an HTML `<table>` or `role="grid"`.
- The observed count was 34, but this is not a stable invariant; acceptance requires at least one.
- `ROUTES.PRODUCTS` owns the route.
- `PRODUCTS_UI` owns `.features_items`, `.product-image-wrapper`, `.productinfo p`, and heading text
  because the third-party application exposes no test attributes. Visible text is used where stable.

## Risks and decisions

| Item                | Resolution                                                               |
| ------------------- | ------------------------------------------------------------------------ |
| Exact catalog size  | Assert non-empty only; never hard-code 34                                |
| Product shape       | Assert `id`, `name`, and `price` for every API product                   |
| Selector strategy   | Visible heading text plus centralized verified CSS fallback              |
| Public CI target    | Approved for these read-only smoke checks                                |
| Mutating/auth flows | Deferred until a separately approved requirement and synthetic lifecycle |

## Approval

- [x] Business behavior matches the authoritative sources.
- [x] Routes, APIs, selectors, and expected outcomes are verified.
- [x] Both active requirements are read-only and data-safe.
- [x] Assertion strength and selector decisions are resolved.
