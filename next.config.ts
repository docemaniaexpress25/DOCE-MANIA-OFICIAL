import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Permite acesso do preview no desenvolvimento (mesma config do repo oficial)
  allowedDevOrigins: [
    "preview-*.space-z.ai",
    "*.space-z.ai",
  ],
};

export default nextConfig;
