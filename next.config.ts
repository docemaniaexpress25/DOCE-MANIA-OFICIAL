import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // e2e: segunda instancia usa NEXT_DIST_DIR=.next-e2e para nao colidir com
  // o .next do dev server principal (nunca definido em producao).
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
