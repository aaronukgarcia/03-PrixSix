// GUID: COMPONENT_LOGO-000-v01
// [Intent] Renders the Prix Six SVG logo at a specified size (sm/md/lg), with priority loading to avoid layout shift on auth pages.
// [Inbound Trigger] Used on login, signup, about, and sidebar header components wherever the brand logo is needed.
// [Downstream Impact] Changing logo.svg or the sizes map here affects all branded surfaces simultaneously.
import Image from 'next/image';

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
      src="/logo.svg"
      alt="Prix Six"
      width={dimension}
      height={dimension}
      className={`rounded-lg ${className}`}
      priority
    />
  );
}
