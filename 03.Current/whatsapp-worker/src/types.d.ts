// GUID: WHATSAPP_WORKER_TYPES-000-v03
// Type declarations for modules without TypeScript definitions

declare module 'qrcode-terminal' {
  export function generate(text: string, options?: { small?: boolean }): void;
  export function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void;
}
