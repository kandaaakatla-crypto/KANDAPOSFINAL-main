import { sortTables } from "./sortTables";

test("sorts T1, T2, T10 numerically, not as text", () => {
  const out = sortTables([{ number: 10 }, { number: 2 }, { number: 1 }, { number: 11 }]).map((t) => t.number);
  expect(out).toEqual([1, 2, 10, 11]);
});

test("does not mutate the input and tolerates empty", () => {
  const input = [{ number: 3 }, { number: 1 }];
  sortTables(input);
  expect(input[0].number).toBe(3);
  expect(sortTables(undefined)).toEqual([]);
});
