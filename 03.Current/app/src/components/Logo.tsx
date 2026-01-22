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
