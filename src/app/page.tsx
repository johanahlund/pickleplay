"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/LoadingState";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Always land on the events list — that's the natural home screen.
    router.replace("/events");
  }, [router]);

  return <LoadingState />;
}
