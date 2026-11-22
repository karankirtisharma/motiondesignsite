import type { ReactNode } from 'react';

// Legacy links redirect to the static cabinet, which owns its own fonts and styles.
export default function StudioLayout({ children }: { children: ReactNode }) {
  return children;
}
