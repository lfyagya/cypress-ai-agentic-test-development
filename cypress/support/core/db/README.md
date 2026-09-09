# Datastore layer (L4) — wiring

The harness ships the **contract**, not the driver. `profile.datastore.driver` says which database
the project uses; a boilerplate that picked for you would be wrong for every project that picked
differently.

## 1. Declare it in the profile

```json
"datastore": {
  "driver": "postgres",
  "access": "direct",
  "credentialSource": "DB_READONLY_URL",
  "readOnly": true
}
```

`harness:ready` refuses a reachable datastore with no `credentialSource`, and refuses write-capable
access with neither `readOnly: true` nor a recorded `writeApproval`. The credential itself never
enters the repository — only the name of the env var or secret that holds it.

## 2. Install the driver in the project

Not a harness dependency. `pg`, `mysql2`, `mssql`, `oracledb` — whichever the profile declares.

## 3. Register the one task

A Cypress test runs in the browser and cannot open a database socket, so every query crosses into
Node through `cy.task`. Register `db:query` once in `cypress.config.js` inside `setupNodeEvents`:

```js
// cypress.config.js — sketch, not a drop-in. Bind parameters in your driver's own style.
setupNodeEvents(on, config) {
  on("task", {
    "db:query": async ({ name, sql, params }) => {
      // Connection string comes from the env var named by profile.datastore.credentialSource.
      // A least-privilege, read-only user unless writes are separately approved.
      const rows = await runInYourDriver(sql, params);
      return rows; // must be a plain array — cy.task serialises the result
    },
  });
}
```

Three things the task must get right:

- **Bind, never interpolate.** `db.engine.js` exposes `parameterNames(sql)` so the task can map
  `:id` to `$1` / `?` / `@id` without every caller learning the driver's style. Concatenating a
  query turns a verification test into an injection vector against the database it verifies.
- **Return a plain array.** `cy.task` serialises across the IPC boundary; driver row objects with
  prototypes or `BigInt` fields will not survive intact. Normalise before returning.
- **Close what you open.** Pool per run, closed on `after:run`, not per query.

## 4. Use it

```js
import { ORDERS_DB } from "@configs/db/modules/orders/orders.db.js";

cy.dbRow(ORDERS_DB.FIND_ORDER_BY_ID, { id: orderId }).then((row) => {
  expect(row.status).to.eq("SETTLED");
  expect(row.total_minor).to.eq(10045); // minor units — never a float round-trip
});
```

| Command                       | Yields                                            |
| ----------------------------- | ------------------------------------------------- |
| `cy.dbQuery(entry, params)`   | all rows                                          |
| `cy.dbRow(entry, params)`     | the one row, failing loudly on 0 or 2+            |
| `cy.dbCount(entry, params)`   | the single aggregate value, normalised to a number |

`cy.dbRow` failing on zero rows is deliberate. A query that quietly matches nothing is the most
common false pass at this layer: the assertion never runs and the test goes green having proved the
row's absence.

## Rules that apply here

| Rule                | Effect                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| `no-sql-literal`    | SQL in a spec or command is refused at write time — it belongs in `cypress/configs/db/**` |
| `smoke-read-only`   | `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `DROP` / `ALTER` in a smoke spec is refused |
| `no-credential-literal` | A connection string written as a literal is refused                  |

What to cover once this is wired: [`docs/backend-testing-coverage.md`](../../../../docs/backend-testing-coverage.md).
