import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  // Pin Turbopack's workspace root to this project — there's a stray
  // package-lock.json in the parent directory which Next would otherwise
  // pick as the root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
