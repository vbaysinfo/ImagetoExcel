import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Sketch → Excel API reads the bundled Excel template from disk.
  outputFileTracingIncludes: {
    "/api/sketch/**": ["./templates/**/*"],
  },
};

export default nextConfig;
