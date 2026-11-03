import { bridgeRequest, hostedOrigin, localHostname, runnerOrigin } from '../shared/browser-bridge';

export const hosted = !localHostname(window.location.hostname);
type Status = { status: 'disconnected' | 'connecting' | 'connected' | 'error'; message: string };
let snapshot: Status = { status: 'disconnected', message: '' };
const listeners = new Set<() => void>();
const changes = new Set<() => void>();
let port: MessagePort | null = null;
let dispose: (() => void) | null = null;
const pending = new Map<
  string,
  { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: number }
>();

function status(next: Status) {
  snapshot = next;
  for (const listener of listeners) listener();
}
export const bridgeSnapshot = () => snapshot;
export const subscribeBridge = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const subscribeChanges = (listener: () => void) => {
  changes.add(listener);
  return () => {
    changes.delete(listener);
  };
};

export function disconnectBridge(message = '') {
  port?.postMessage({ type: 'disconnect' });
  port?.close();
  port = null;
  dispose?.();
  dispose = null;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(
      new Error('Đã mất kết nối runner. Kiểm tra trạng thái trước khi gửi lại thao tác.'),
    );
  }
  pending.clear();
  status({ status: message ? 'error' : 'disconnected', message });
}

function attach(next: MessagePort) {
  port = next;
  let lastPing = Date.now();
  next.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ping') {
      lastPing = Date.now();
      next.postMessage({ type: 'pong' });
    } else if (data.type === 'change') {
      for (const listener of changes) listener();
    } else if (data.type === 'disconnect') {
      disconnectBridge('Runner đã ngắt kết nối. Bấm Kết nối runner để thử lại.');
    } else if (data.type === 'response' && typeof data.id === 'string') {
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      clearTimeout(item.timer);
      if (typeof data.error === 'string') item.reject(new Error(data.error));
      else item.resolve(data.data);
    }
  };
  next.onmessageerror = () => disconnectBridge('Không đọc được phản hồi từ runner.');
  const heartbeat = window.setInterval(() => {
    if (Date.now() - lastPing > 45000)
      disconnectBridge('Runner không phản hồi. Kết nối lại để tiếp tục.');
  }, 5000);
  const previous = dispose;
  dispose = () => {
    previous?.();
    clearInterval(heartbeat);
  };
  status({ status: 'connected', message: '' });
}

export function bridgeApi<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  if (!port || snapshot.status !== 'connected')
    return Promise.reject(new Error('Kết nối runner trước khi thực hiện thao tác.'));
  if (pending.size >= 64)
    return Promise.reject(new Error('Runner đang xử lý nhiều yêu cầu. Thử lại sau.'));
  const request = bridgeRequest.parse({
    type: 'request',
    id: crypto.randomUUID(),
    path,
    method: body === undefined ? 'GET' : method,
    ...(body === undefined ? {} : { body }),
  });
  if (JSON.stringify(request).length > 128 * 1024)
    return Promise.reject(new Error('Yêu cầu quá lớn.'));
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(request.id);
      reject(new Error('Runner chưa phản hồi. Kiểm tra trạng thái trước khi gửi lại thao tác.'));
    }, 120000);
    pending.set(request.id, { resolve: resolve as (data: unknown) => void, reject, timer });
    port!.postMessage(request);
  });
}

export function connectBridge(portNumber: string) {
  disconnectBridge();
  if (window.location.origin !== hostedOrigin) {
    status({ status: 'error', message: `Hãy kết nối từ địa chỉ chính thức ${hostedOrigin}.` });
    return;
  }
  const origin = runnerOrigin(portNumber);
  const nonce = crypto.randomUUID();
  const popup = window.open(
    `${origin}/#connect`,
    `relay-runner-${nonce}`,
    'popup,width=620,height=700',
  );
  if (!popup) {
    status({
      status: 'error',
      message: 'Trình duyệt đã chặn cửa sổ kết nối. Cho phép popup rồi thử lại.',
    });
    return;
  }
  status({
    status: 'connecting',
    message: 'Đang mở runner… Chọn Cho phép kết nối trong cửa sổ vừa mở.',
  });
  let ready = false;
  const listener = (event: MessageEvent) => {
    if (event.source !== popup || event.origin !== origin || event.data?.nonce !== nonce) return;
    if (event.data.type === 'relay:ready' && !ready) {
      ready = true;
      clearTimeout(unavailable);
    } else if (event.data.type === 'relay:connected' && event.ports.length === 1) {
      clearInterval(greet);
      clearTimeout(timeout);
      clearTimeout(unavailable);
      window.removeEventListener('message', listener);
      attach(event.ports[0]);
    } else if (event.data.type === 'relay:rejected') disconnectBridge('Bạn đã từ chối kết nối.');
  };
  window.addEventListener('message', listener);
  const greet = window.setInterval(
    () => popup.postMessage({ type: 'relay:connect', nonce }, origin),
    500,
  );
  const closed = window.setInterval(() => {
    if (popup.closed)
      disconnectBridge(
        'Cửa sổ runner đã đóng. Nếu trình duyệt trong ứng dụng không giữ được popup, mở web bằng Chrome hoặc Edge rồi kết nối lại.',
      );
  }, 1000);
  const timeout = window.setTimeout(
    () =>
      disconnectBridge(
        'Chưa kết nối được runner. Chạy npm start trên máy này, kiểm tra cổng và cho phép popup.',
      ),
    90000,
  );
  const unavailable = window.setTimeout(
    () =>
      disconnectBridge(
        'Runner chưa chạy hoặc chưa được cập nhật. Chạy npm run build và npm start trên máy này, kiểm tra cổng rồi kết nối lại.',
      ),
    12000,
  );
  dispose = () => {
    clearInterval(greet);
    clearInterval(closed);
    clearTimeout(timeout);
    clearTimeout(unavailable);
    window.removeEventListener('message', listener);
    if (snapshot.status === 'connecting' && !popup.closed) popup.close();
  };
}

// Session popouts inherit only their explicitly registered parent's live bridge.
// Reloading or opening an unrelated tab requires a new local approval.
const children = new Set<Window>();
export function registerSessionWindow(child: Window | null) {
  if (hosted && child) children.add(child);
}
if (hosted) {
  window.addEventListener('message', (event) => {
    if (
      event.origin !== window.location.origin ||
      event.data?.type !== 'relay:child' ||
      !children.has(event.source as Window) ||
      snapshot.status !== 'connected'
    )
      return;
    const child = event.source as Window;
    children.delete(child);
    const channel = new MessageChannel();
    const link = channel.port1;
    let active = true;
    let inFlight = 0;
    const stop = () => {
      if (!active) return;
      active = false;
      link.postMessage({ type: 'disconnect' });
      link.close();
      off();
      offStatus();
      clearInterval(timer);
    };
    const off = subscribeChanges(() => {
      if (active) link.postMessage({ type: 'change' });
    });
    const offStatus = subscribeBridge(() => {
      if (snapshot.status !== 'connected') stop();
    });
    const timer = window.setInterval(() => {
      if (child.closed || snapshot.status !== 'connected') stop();
      else link.postMessage({ type: 'ping' });
    }, 2000);
    link.onmessage = async ({ data }) => {
      if (data?.type === 'disconnect') {
        stop();
        return;
      }
      const parsed = bridgeRequest.safeParse(data);
      if (!parsed.success || !active) return;
      const request = parsed.data;
      if (inFlight >= 32) {
        link.postMessage({
          type: 'response',
          id: request.id,
          error: 'Quá nhiều yêu cầu đang chờ.',
        });
        return;
      }
      inFlight++;
      try {
        const result = await bridgeApi(request.path, request.body, request.method);
        if (active) link.postMessage({ type: 'response', id: request.id, data: result });
      } catch (error) {
        if (active)
          link.postMessage({ type: 'response', id: request.id, error: (error as Error).message });
      } finally {
        inFlight--;
      }
    };
    child.postMessage({ type: 'relay:child-connected' }, window.location.origin, [channel.port2]);
  });
  if (window.opener && window.location.hash.startsWith('#session=')) {
    const parent = window.opener;
    const listener = (event: MessageEvent) => {
      if (
        event.source !== parent ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'relay:child-connected' ||
        event.ports.length !== 1
      )
        return;
      clearInterval(greet);
      clearTimeout(timeout);
      window.removeEventListener('message', listener);
      attach(event.ports[0]);
    };
    window.addEventListener('message', listener);
    const greet = window.setInterval(
      () => parent.postMessage({ type: 'relay:child' }, window.location.origin),
      300,
    );
    const timeout = window.setTimeout(() => {
      clearInterval(greet);
      window.removeEventListener('message', listener);
    }, 5000);
  }
  window.addEventListener('pagehide', () => disconnectBridge());
}
