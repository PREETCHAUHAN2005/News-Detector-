import type { NextConfig } from "next";

/**
 * Security headers (OWASP secure-headers baseline, dev-compatible):
 * - X-Frame-Options DENY            → clickjacking / UI-redress defence
 * - X-Content-Type-Options nosniff  → MIME-type sniffing defence
 * - Referrer-Policy                 → cross-origin referrer leakage defence
 * - Permissions-Policy              → camera/mic/geolocation hard-off
 * - X-DNS-Prefetch-Control off      → no cross-origin DNS prefetch hints
 *
 * A strict CSP is intentionally NOT set here: Next.js dev mode requires
 * unsafe-inline/eval for HMR and styled-jsx, which would make the policy
 * either broken or meaningless. Revisit for production builds.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
