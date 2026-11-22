"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { isAndroidPhone } from '../lib/entryDevice';
import { PUBLIC_CABINET } from '@/studio/lib/cabinet';

/** Resolve the phone redirect before mounting the lounge's loader/runtime. */
export default function LoungeEntry({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (isAndroidPhone(navigator)) { location.replace(PUBLIC_CABINET); return; }
    // The Living Maquette intro is the entry UI, including its Lite Version choice.
    // Do not put a second, reset-on-refresh chooser in front of it.
    setReady(true);
  }, []);
  if (ready) return children;
  return null;
}
