import { useEffect, useRef, useState } from 'react';
import { usePortalLocale } from './PortalLocale';
import type { TitleScene } from './puffy-title-scene';
import './puffy-title.css';

export default function PuffyTitle({ iteration }: { iteration: number }) {
  const { locale } = usePortalLocale();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TitleScene | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'poster'>('loading');
  const english = locale === 'en';

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    const controller = new AbortController();
    void import('./puffy-title-scene')
      .then(({ createTitleScene }) =>
        createTitleScene(element, controller.signal, () => {
          if (!cancelled) setState('poster');
        }),
      )
      .then((instance) => {
        if (cancelled) instance.dispose();
        else {
          scene.current = instance;
          setState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setState('poster');
      });
    return () => {
      cancelled = true;
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.reset();
  }, [iteration]);

  return (
    <div className="kp-puffy-title" data-title-state={state}>
      <img
        className="kp-puffy-poster"
        src="/art/kivuno-puffy-title-poster.webp"
        alt=""
        aria-hidden="true"
        width="1440"
        height="960"
        fetchPriority="high"
      />
      <div
        ref={host}
        className="kp-puffy-stage"
        role="img"
        aria-label={
          state === 'ready'
            ? english
              ? 'Four rows of soft, sculpted Kivuno letters. Press to squish, drag to rotate, release to return slowly. Arrow keys rotate; Space presses a letter; Home resets.'
              : 'Bốn hàng chữ Kivuno phồng mềm. Nhấn để làm lõm, kéo để xoay, thả để từ từ trở về. Phím mũi tên để xoay, Space để nhấn chữ, Home để đặt lại.'
            : english
              ? 'Four rows of soft, sculpted Kivuno letters in violet and lime.'
              : 'Bốn hàng chữ Kivuno phồng mềm màu violet và lime.'
        }
        tabIndex={state === 'ready' ? 0 : -1}
      />
    </div>
  );
}
