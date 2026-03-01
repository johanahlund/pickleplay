"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Force clear all old caches and re-register
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((r) => r.unregister());
      });
      caches.keys().then((keys) => {
        keys.forEach((k) => caches.delete(k));
      });
      // Re-register fresh after a short delay
      setTimeout(() => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }, 1000);
    }
  }, []);

  return null;
}
