import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/outfit/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/domine/500.css";
import "@fontsource/domine/600.css";
import "@fontsource/domine/700.css";
import "@/index.css";
import App from "@/App";
import { getTheme, applyTheme } from "@/lib/theme";

// Set before first paint so a device already in dark mode doesn't flash
// light-then-dark on load.
applyTheme(getTheme());

// The Kanda Dashboard phone app draws its own chrome under the iOS notch and
// home indicator (see the --safe-top/--safe-bottom tokens in App.css), which
// needs viewport-fit=cover for env(safe-area-inset-*) to report real values.
// Scoped to that build so the web pages' layout is unchanged.
if (process.env.REACT_APP_APP_TARGET === "dashboard") {
  document.querySelector('meta[name="viewport"]')
    ?.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
}

// Optional — unset REACT_APP_SENTRY_DSN (e.g. local dev) leaves this a no-op.
if (process.env.REACT_APP_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REACT_APP_SENTRY_DSN,
    environment: process.env.REACT_APP_SENTRY_ENVIRONMENT || "production",
    tracesSampleRate: 0.1,
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
