import { useEffect, useRef, useState } from 'react';
import type { FooterGlassScene } from './footer-glass-scene';
import './footer-glass.css';

/** Decorative glass. The real photo underneath also serves as the no-WebGL fallback. */
export default function FooterGlass() {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    const element = host.current;
    const footer = element?.closest('footer');
    if (!element || !footer) return;
    const controller = new AbortController();
    let disposed = false;
    let started = false;
    let visible = false;
    let scene: FooterGlassScene | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        scene?.setVisible(visible);
        if (!visible || started) return;
        started = true;
        void import('./footer-glass-scene')
          .then(({ createFooterGlassScene }) =>
            createFooterGlassScene(element, footer, controller.signal, () => {
              if (!disposed) setState('fallback');
            }),
          )
          .then((instance) => {
            if (disposed) return instance.dispose();
            scene = instance;
            instance.setVisible(visible);
            setState('ready');
          })
          .catch(() => {
            if (!disposed) setState('fallback');
          });
      },
      { threshold: 0 },
    );
    // The inner footer is fixed: observing it would load WebGL above the fold.
    observer.observe(footer);
    return () => {
      disposed = true;
      controller.abort();
      observer.disconnect();
      scene?.dispose();
    };
  }, []);

  return <div ref={host} className="kp-footer-glass" data-glass-state={state} aria-hidden="true" />;
}
