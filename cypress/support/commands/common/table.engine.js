/**
 * Maps a caller-facing sort direction to the `aria-sort` token a header must expose.
 *
 * `assertTableColumnSorted` used to treat every value other than the exact string
 * `"asc"` as descending. `"ascending"` (the aria token) and `"ASC"` (SQL) then
 * asserted the opposite order and greened an inverted sort.
 */
export function ariaSortForDirection(direction) {
  switch (String(direction ?? "").toLowerCase()) {
    case "asc":
    case "ascending":
      return "ascending";
    case "desc":
    case "descending":
      return "descending";
    default: {
      throw new Error(
        `assertTableColumnSorted direction must be "asc" or "desc" (or "ascending"/"descending"), got ${JSON.stringify(direction)}`,
      );
    }
  }
}
