import { timeAgo } from "./timeAgo";

const NOW = new Date("2026-10-10T12:00:00Z").getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000;

test("under a minute", () => expect(timeAgo(ago(20000), NOW)).toBe("just now"));
test("minutes", () => expect(timeAgo(ago(5 * MIN), NOW)).toBe("5 min ago"));
test("hours", () => expect(timeAgo(ago(125 * MIN), NOW)).toBe("2 hr ago"));
test("yesterday and days", () => {
  expect(timeAgo(ago(30 * 60 * MIN), NOW)).toBe("yesterday");
  expect(timeAgo(ago(3 * 24 * 60 * MIN), NOW)).toBe("3 days ago");
});
test("old orders show a date, not 11250 min", () => {
  expect(timeAgo(ago(11250 * MIN), NOW)).toBe("2 Oct 2026");
});
test("bad input is empty", () => expect(timeAgo("nope", NOW)).toBe(""));
