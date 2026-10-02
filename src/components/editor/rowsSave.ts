// What a card's "Save Changes" does with its list of rows, decided as a pure function so it can be tested.
//
// "Add" in these cards makes a row on screen only (id starts with "new:"), so the rules are about what
// Save does with each row:
//   - ok + added on screen      -> INSERT it (it now has real content)
//   - ok + already saved        -> UPDATE it
//   - empty + added on screen   -> DROP it (never reaches the database)
//   - empty + already saved     -> left untouched (an old empty row from before this behaviour)
//   - has other content but is missing what makes it usable -> REFUSE, with a reason shown on that row
//   - invalid                   -> REFUSE, with a reason

export type RowCheck<P> =
  | { state: "ok"; payload: P }
  | { state: "empty"; hasOtherContent: boolean }
  | { state: "invalid"; reason: string };

export interface RowsSavePlan<R extends { id: string }, P> {
  drop: string[];
  updates: { row: R; payload: P }[];
  /** `position` = the row's place in the list once dropped rows are gone. */
  inserts: { row: R; payload: P; position: number }[];
  errors: Record<string, string>;
}

export const isNewRowId = (id: string) => id.startsWith("new:");

export function planRowsSave<R extends { id: string }, P>(rows: R[], classify: (row: R) => RowCheck<P>): RowsSavePlan<R, P> {
  const plan: RowsSavePlan<R, P> = { drop: [], updates: [], inserts: [], errors: {} };
  let position = 0;
  for (const row of rows) {
    const check = classify(row);
    if (check.state === "empty") {
      if (check.hasOtherContent) {
        plan.errors[row.id] = "required";
        position++;
      } else if (isNewRowId(row.id)) {
        plan.drop.push(row.id);
      } else {
        position++; // an old empty row stays where it is, untouched
      }
      continue;
    }
    if (check.state === "invalid") {
      plan.errors[row.id] = check.reason;
      position++;
      continue;
    }
    if (isNewRowId(row.id)) plan.inserts.push({ row, payload: check.payload, position });
    else plan.updates.push({ row, payload: check.payload });
    position++;
  }
  return plan;
}
