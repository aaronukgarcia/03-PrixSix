import type {NextConfig} from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Explicitly set workspace root to this directory to prevent Next.js from
  // walking up to parent lockfiles (03.Current/ and 03-PrixSix/ both have stale ones).
  outputFileTracingRoot: path.resolve(__dirname),
  // Using Firebase App Hosting (not static export)
  typescript: {
    ignoreBuildErrors: true,
  },
  // eslint.ignoreDuringBuilds removed in Next.js 16; ESLint config handled via eslint.config.js
  // Next.js 16: Turbopack is default. Empty turbopack config signals intentional use.
  // The opentelemetry/instrumentation webpack workaround is not needed under Turbopack.
  turbopack: {},
  // @SECURITY_FIX (cyber.md M-3): the app previously sent NO security headers (no CSP/HSTS/
  // X-Frame-Options/X-Content-Type-Options, and no middleware). Add a baseline set applied to every
  // route. HSTS pins HTTPS; frame-ancestors/X-Frame-Options block clickjacking; nosniff blocks MIME
  // sniffing. The CSP is deliberately permissive on script/style ('unsafe-inline'/'unsafe-eval') because
  // Next.js + the current inline styles/GA need it — it still forbids framing and object embeds and is a
  // meaningful defence-in-depth baseline. Tighten toward nonces in a later hardening pass.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'media.formula1.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
