// GUID: COMPONENT_LOGO-000-v02
// [Intent] Renders the Prix Six SVG logo at a specified size (sm/md/lg), with priority loading to avoid layout shift on auth pages.
// [Inbound Trigger] Used on login, signup, about, and sidebar header components wherever the brand logo is needed.
// [Downstream Impact] Changing logo.svg or the sizes map here affects all branded surfaces simultaneously.
// @FIX(BUG-PUBLIC-404, v3.20.2): the logo was `src="/logo.svg"` and had been silently BROKEN in
//   production for as long as it has existed. Firebase App Hosting does not serve app/public over
//   HTTP: verified 2026-07-28 against the origin directly (europe-west4.hosted.app, bypassing
//   Cloudflare) — /api/version answers 3.20.1 while /logo.svg 404s. The files ARE deployed (the
//   results-email chart reads public/fonts/Roboto-Regular.ttf off disk via process.cwd() and works),
//   so this is a static-serving gap, not a missing-file one. `next start` locally serves it fine,
//   which is why it never showed up in development.
//   Fix: import the asset so the bundler emits it under /_next/static/media/, which IS served —
//   every script and stylesheet the app loads comes from there. Static import also gives next/image
//   the intrinsic dimensions for free.
import Image from 'next/image';
import logoAsset from '@/assets/logo.svg';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 32,  // For sidebar
  md: 48,  // For auth pages
  lg: 64,  // For larger displays
};

export function Logo({ size = 'md', className = '' }: LogoProps) {
  const dimension = sizes[size];

  return (
    <Image
      src={logoAsset}
      alt="Prix Six"
      width={dimension}
      height={dimension}
      className={`rounded-lg ${className}`}
      priority
    />
  );
}
