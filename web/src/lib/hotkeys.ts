'use client';
import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts: '/', 'n' (ignored while typing in a field), 'Escape',
 * 'mod+s' (Ctrl / Cmd + S, also while typing).
 */
export function useHotkeys(map: Record<string, (() => void) | undefined>, enabled = true) {
  const ref = useRef(map);
  useEffect(() => { ref.current = map; });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const k = (e.ctrlKey || e.metaKey) ? `mod+${e.key.toLowerCase()}` : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const fn = ref.current[k];
      if (!fn || (typing && !k.startsWith('mod+') && k !== 'Escape')) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
