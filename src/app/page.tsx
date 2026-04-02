"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/clubs");
  }, [router]);

  return <div className="text-center py-12 text-muted">Loading...</div>;
}
