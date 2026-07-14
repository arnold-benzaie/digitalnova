import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project — without this, Next infers it
  // from the nearest lockfile up the directory tree, which in this repo
  // layout picks up an unrelated lockfile several levels above `app/`.
  outputFileTracingRoot: path.join(__dirname),
  // Documents are stored as base64 in Postgres (no object storage
  // configured yet — see db/schema.ts `documents`), so uploads go through
  // a Server Action; raise the default 1MB body limit to fit them.
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
