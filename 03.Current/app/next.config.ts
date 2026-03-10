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
