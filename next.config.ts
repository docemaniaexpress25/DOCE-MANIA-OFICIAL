import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BLOCO 159: na VERCEL o builder exige o output PADRAO (standalone quebra a
  // etapa de file tracing: ENOENT .next/next-server.js.nft.json). O
  // "standalone" fica so para self-host/sandbox (npm run build:standalone).
  output: process.env.VERCEL ? undefined : "standalone",
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
