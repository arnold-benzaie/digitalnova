import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project — without this, Next infers it
  // from the nearest lockfile up the directory tree, which in this repo
  // layout picks up an unrelated lockfile several levels above `app/`.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
