import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // OFX statements are uploaded through a server action
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
