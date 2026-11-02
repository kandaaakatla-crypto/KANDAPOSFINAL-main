import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LandingPage from "./LandingPage";

// Jest can't resolve react-router v7's package exports here; the page only
// needs <Link>, which renders a plain anchor for the purposes of this test.
jest.mock("react-router-dom", () => {
  const R = require("react");
  return {
    Link: ({ to, children, ...rest }) => R.createElement("a", { href: to, ...rest }, children),
  };
}, { virtual: true });

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(async () => { root.render(<LandingPage />); });

test("landing page no longer says the product is coming soon", async () => {
  await render();
  const text = container.textContent.toLowerCase();
  expect(text).not.toMatch(/coming soon|launching soon|alpha waitlist|join the alpha/);
  expect(document.title.toLowerCase()).not.toMatch(/coming soon/);
  const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  expect(desc.toLowerCase()).not.toMatch(/coming soon|launching soon|waitlist/);
  expect(text).toMatch(/available now/);
});

test("header has a Sign in link to the dashboard login", async () => {
  await render();
  const header = container.querySelector("header");
  const links = Array.from(header.querySelectorAll("a")).filter((a) => /sign in/i.test(a.textContent));
  expect(links.length).toBeGreaterThan(0);
  links.forEach((a) => expect(a.getAttribute("href")).toBe("/dashboard/login"));
});
