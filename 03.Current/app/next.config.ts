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
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Suppress "Critical dependency: the request of a dependency is an expression"
    // warning from @opentelemetry/instrumentation (used by genkit). The dynamic
    // require in that module is intentional and works fine at runtime.
    config.module.rules.push({
      test: /[\\/]@opentelemetry[\\/]instrumentation[\\/]/,
      resolve: { fullySpecified: false },
    });
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /opentelemetry/ },
    ];
    return config;
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
