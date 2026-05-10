"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Always unregister any existing SW + clear caches on mount. Tooling
    // updates the SW source frequently, and a stale registration is the
    // single biggest cause of "blank page" / phantom 404s in development.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((r) => r.unregister());
    });
    caches.keys().then((keys) => {
      keys.forEach((k) => caches.delete(k));
    });

    // Skip registration on localhost / 127.0.0.1 / *.local — devs hitting
    // a half-compiled route would otherwise cache 404s and ship them back
    // until the next manual "clear site data".
    const host = window.location.hostname;
    const isLocal = host === "localhost"
      || host === "127.0.0.1"
      || host.endsWith(".local")
      || host.endsWith(".localhost");
    if (isLocal) return;

    // Production: re-register fresh after a short delay.
    setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, 1000);
  }, []);

  return null;
}
