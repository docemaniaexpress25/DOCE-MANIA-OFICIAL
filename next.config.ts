import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Permite acesso do preview no desenvolvimento
  allowedDevOrigins: [
    "https://preview-*.space-z.ai",
  ],
};

export default nextConfig;
