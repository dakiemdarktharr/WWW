import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { animate } from 'motion/mini';
import './public-navigation.css';

const loadPortal = () => import('./Portal');
const loadBilling = () => import('./Billing');
const Portal = lazy(loadPortal);
const Billing = lazy(loadBilling);

async function waitForVisuals(finished: Promise<unknown>) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      finished.then(() => true),
      new Promise<boolean>((resolve) => {
        deadline = setTimeout(() => resolve(false), 1500);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

// Cover / swap / reveal, with horizontal slats inspired by Motion's blinds.
// Keep ordinary anchors so downloads, new tabs and browser history still work.
export default function PublicRouter() {
  const [route, setRoute] = useState(() => location.pathname + location.search);
  const busy = useRef(false);
  const pending = useRef<{ url: URL; push: boolean } | null>(null);
  const current = useRef(route);

  useEffect(() => {
    let disposed = false;
    let overlay: HTMLDivElement | null = null;
    const controls: ReturnType<typeof animate>[] = [];
    function clearOverlay() {
      controls.forEach((animation) => animation.cancel());
      controls.length = 0;
      overlay?.remove();
      overlay = null;
    }
    async function navigate(url: URL, push: boolean) {
      if (busy.current) {
        pending.current = { url, push };
        return;
      }
      if (url.pathname + url.search === current.current) return;
      busy.current = true;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const preload = url.pathname === '/billing' ? loadBilling() : loadPortal();
      // Start fetching the next page while the slats close; never show a blank page.
      let loadDeadline: ReturnType<typeof setTimeout> | undefined;
      const loaded = Promise.race([
        preload.then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => {
          loadDeadline = setTimeout(() => resolve(false), 12000);
        }),
      ]);
      const previousFocus = document.activeElement;
      try {
        if (!reduced) {
          overlay = document.createElement('div');
          overlay.className = 'kp-route-blinds';
          overlay.setAttribute('aria-hidden', 'true');
          overlay.setAttribute('popover', 'manual');
          const count = Math.ceil(innerHeight / 72);
          for (let i = 0; i < count; i++) {
            const slat = document.createElement('div');
            slat.className = 'kp-route-slat';
            slat.style.top = `${(i / count) * 100}%`;
            slat.style.height = `calc(${100 / count}% + 1px)`;
            overlay.append(slat);
          }
          document.body.append(overlay);
          if (typeof overlay.showPopover === 'function') overlay.showPopover();
          const covered = await waitForVisuals(
            Promise.all(
              [...overlay.children].map((slat) => {
                const animation = animate(
                  slat,
                  { transform: ['scaleY(0)', 'scaleY(1)'] },
                  { duration: 0.42, ease: [0.76, 0, 0.24, 1] },
                );
                controls.push(animation);
                return animation.finished;
              }),
            ),
          );
          if (!covered) clearOverlay();
        }
        if (!(await loaded)) {
          location.assign(url.href);
          return;
        }
        if (disposed) return;
        if (push) history.pushState(null, '', url.pathname + url.search + url.hash);
        current.current = url.pathname + url.search;
        flushSync(() => setRoute(current.current));
        window.scrollTo({ top: 0, behavior: 'instant' });
        // Let the preloaded page and theme commit before uncovering it.
        await waitForVisuals(
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
        );
        if (disposed) return;
        const heading =
          document.querySelector<HTMLElement>('[role="dialog"] h2') ||
          document.querySelector<HTMLElement>('h1');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        } else if (previousFocus instanceof HTMLElement) previousFocus.blur();
        if (overlay) {
          await waitForVisuals(
            Promise.all(
              [...overlay.children].map((slat) => {
                (slat as HTMLElement).style.transformOrigin = 'center bottom';
                const animation = animate(
                  slat,
                  { transform: ['scaleY(1)', 'scaleY(0)'] },
                  { duration: 0.52, ease: [0.76, 0, 0.24, 1] },
                );
                controls.push(animation);
                return animation.finished;
              }),
            ),
          );
        }
      } catch {
        // A failed animation should never leave an opaque page or break a link.
        if (!disposed) location.assign(url.href);
      } finally {
        clearTimeout(loadDeadline);
        clearOverlay();
        busy.current = false;
        const next = pending.current;
        pending.current = null;
        if (next && !disposed) void navigate(next.url, next.push);
      }
    }
    function clicked(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element)?.closest?.('a[href]');
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || !['/', '/billing'].includes(url.pathname)) return;
      if (url.pathname + url.search === current.current) return;
      event.preventDefault();
      void navigate(url, true);
    }
    const popped = () => {
      void navigate(new URL(location.href), false);
    };
    document.addEventListener('click', clicked);
    window.addEventListener('popstate', popped);
    return () => {
      disposed = true;
      clearOverlay();
      document.removeEventListener('click', clicked);
      window.removeEventListener('popstate', popped);
    };
  }, []);

  const url = new URL(route, location.origin);
  return (
    <Suspense fallback={null}>
      {url.pathname === '/billing' ? (
        <Billing
          key={route}
          rail={
            import.meta.env.DEV &&
            import.meta.env.KIVUNO_BANK_DEMO &&
            url.searchParams.get('demo') !== 'fuji'
              ? 'bank'
              : 'fuji'
          }
        />
      ) : (
        <Portal key={route} />
      )}
    </Suspense>
  );
}
