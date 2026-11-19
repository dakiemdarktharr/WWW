import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
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
              ? 'Four rows of soft, sculpted Kivuno letters. Drag to rotate; release to return. Arrow keys also rotate; Home resets.'
              : 'Bốn hàng chữ Kivuno phồng mềm. Kéo để xoay, thả để trở về. Phím mũi tên để xoay, Home để đặt lại.'
            : english
              ? 'Four rows of soft, sculpted Kivuno letters in violet and lime.'
              : 'Bốn hàng chữ Kivuno phồng mềm màu violet và lime.'
        }
        tabIndex={state === 'ready' ? 0 : -1}
      />
      {state === 'ready' && (
        <div className="kp-puffy-controls">
          <span>{english ? 'Drag, turn, let go.' : 'Kéo, xoay, rồi thả.'}</span>
          <button
            type="button"
            onClick={() => scene.current?.reset()}
            aria-label={english ? 'Reset title rotation' : 'Đặt lại góc xoay tiêu đề'}
            title={english ? 'Reset title rotation' : 'Đặt lại góc xoay tiêu đề'}
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
