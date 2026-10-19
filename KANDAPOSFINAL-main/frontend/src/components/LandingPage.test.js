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

// Animation layers: swap for plain elements so the copy renders in jsdom.
jest.mock("framer-motion", () => {
  const R = require("react");
  const MOTION_PROPS = ["initial", "animate", "exit", "transition", "variants", "whileInView",
    "whileHover", "whileTap", "viewport", "layout", "style"];
  const strip = (props) => {
    const out = { ...props };
    MOTION_PROPS.forEach((k) => { if (k !== "style") delete out[k]; });
    return out;
  };
  const m = new Proxy({}, {
    get: (_t, tag) => ({ children, ...props }) => R.createElement(tag, strip(props), children),
  });
  const Pass = ({ children }) => R.createElement(R.Fragment, null, children);
  return { m, motion: m, AnimatePresence: Pass, MotionConfig: Pass, LazyMotion: Pass, domAnimation: {} };
});
jest.mock("./landing/motion", () => {
  const R = require("react");
  const Pass = ({ children }) => R.createElement("div", null, children);
  return {
    WordReveal: ({ text }) => R.createElement("h1", null, text),
    Rise: Pass,
    ScrollWords: ({ text }) => R.createElement("p", null, text),
    Marquee: Pass,
    HoverList: () => null,
    ServiceRows: () => null,
    ScaleCta: ({ title, cta, href }) => R.createElement("a", { href }, title, cta),
  };
});
jest.mock("./landing/immersive", () => {
  const R = require("react");
  const Pass = ({ children }) => R.createElement(R.Fragment, null, children);
  return {
    useSmoothScroll: () => {},
    CursorFollower: () => null,
    Magnetic: Pass,
    CountUp: ({ to, suffix }) => R.createElement("span", null, `${to}${suffix || ""}`),
    StackCards: () => null,
    HorizontalScroll: () => null,
  };
});
jest.mock("./landing/visuals", () => ({
  OrderScreenMock: () => null, KdsMock: () => null, DispatchMock: () => null, ReportsMock: () => null, PulseRings: () => null,
}));
jest.mock("./landing/HeroOrderPanel", () => () => null);

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
