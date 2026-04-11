"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Restore last page or default to events
    const lastPage = typeof window !== "undefined" ? localStorage.getItem("pickleplay_lastPage") : null;
    router.replace(lastPage || "/events");
  }, [router]);

  return <div className="text-center py-12 text-muted">Loading...</div>;
}
