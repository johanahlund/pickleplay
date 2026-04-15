"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Always land on the events list — that's the natural home screen.
    router.replace("/events");
  }, [router]);

  return <div className="text-center py-12 text-muted">Loading...</div>;
}
