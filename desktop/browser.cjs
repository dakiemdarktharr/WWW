'use strict';

const { WebContentsView, session } = require('electron');
const { createHash } = require('node:crypto');

function browserUrl(value, backendOrigin, testing = false) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a website address.');
  const url = new URL(value);
  if (url.username || url.password || url.origin === backendOrigin)
    throw new Error('This address cannot open in the project browser.');
  const host = url.hostname.toLowerCase();
  const fixture = testing && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host);
  if (
    !fixture &&
    (url.protocol !== 'https:' ||
      host.includes(':') ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      !host.includes('.') ||
      /^\d+(?:\.\d+){3}$/.test(host))
  )
    throw new Error('Use a public HTTPS website.');
  return url.href;
}

function browserBounds(value, size) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])))
    throw new Error('Invalid browser viewport.');
  const x = Math.max(0, Math.min(Math.round(value.x), size[0]));
  const y = Math.max(40, Math.min(Math.round(value.y), size[1]));
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.round(value.width), size[0] - x)),
    height: Math.max(0, Math.min(Math.round(value.height), size[1] - y)),
  };
}

// Fixed script in an isolated world, never supplied by agents or remote pages.
// Deliberately excludes inputs, editable areas, hidden content, scripts and frames.
const visibleTextScript = `(() => {
  const chunks = []; let length = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && length < 20000) {
    const node = walker.currentNode; const element = node.parentElement;
    if (!element || element.closest('script,style,noscript,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0' || !element.getClientRects().length) continue;
    if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const text = node.textContent.replace(/\\s+/g, ' ').trim();
    if (text) { chunks.push(text); length += text.length + 1; }
  }
  return chunks.join('\\n').slice(0,20000);
})()`;

function redact(value) {
  return value
    .replace(/\b(?:sk-|gh[opusr]_)[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]');
}

class ProjectBrowser {
  constructor({ getWindow, getBackendOrigin, getOwnerId, testing = false }) {
    this.getWindow = getWindow;
    this.getBackendOrigin = getBackendOrigin;
    this.getOwnerId = getOwnerId;
    this.testing = testing;
    this.view = null;
    this.projectId = '';
    this.error = '';
    this.partitions = new Set();
    this.suspendTimer = null;
  }
  state() {
    const contents = this.view?.webContents;
    return {
      active: Boolean(contents && !contents.isDestroyed()),
      projectId: this.projectId,
      url: contents && !contents.isDestroyed() ? contents.getURL() : '',
      title: contents && !contents.isDestroyed() ? contents.getTitle().slice(0, 200) : '',
      loading: contents && !contents.isDestroyed() ? contents.isLoading() : false,
      canGoBack:
        contents && !contents.isDestroyed() ? contents.navigationHistory.canGoBack() : false,
      canGoForward:
        contents && !contents.isDestroyed() ? contents.navigationHistory.canGoForward() : false,
      error: this.error,
    };
  }
  emit() {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('relay:browser-state', this.state());
  }
  policy(url) {
    return browserUrl(url, this.getBackendOrigin(), this.testing);
  }
  async open({ projectId, url, bounds }) {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 128)
      throw new Error('Choose a project first.');
    const target = this.policy(url);
    const owner = this.getOwnerId();
    if (!owner) throw new Error('Sign in first.');
    if (this.projectId !== projectId) this.close();
    this.projectId = projectId;
    this.error = '';
    if (!this.view) {
      const partition =
        'persist:kivuno-browser-' +
        createHash('sha256')
          .update(owner + '\0' + projectId)
          .digest('hex');
      const browserSession = session.fromPartition(partition, { cache: false });
      if (!this.partitions.has(partition)) {
        this.partitions.add(partition);
        browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false),
        );
        browserSession.setPermissionCheckHandler(() => false);
        browserSession.on('will-download', (event) => event.preventDefault());
        browserSession.webRequest.onBeforeRequest((details, callback) => {
          try {
            if (details.url.startsWith('data:') || details.url.startsWith('blob:'))
              return callback({});
            this.policy(details.url);
            callback({});
          } catch {
            callback({ cancel: true });
          }
        });
        browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
          const headers = { ...details.requestHeaders };
          for (const key of Object.keys(headers))
            if (key.toLowerCase().startsWith('x-relay-')) delete headers[key];
          callback({ requestHeaders: headers });
        });
      }
      const view = new WebContentsView({
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          backgroundThrottling: true,
          navigateOnDragDrop: false,
          spellcheck: false,
        },
      });
      this.view = view;
      view.setBackgroundColor('#ffffff');
      this.getWindow().contentView.addChildView(view);
      const contents = view.webContents;
      contents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11') {
          event.preventDefault();
          const win = this.getWindow();
          win.setFullScreen(!win.isFullScreen());
        }
      });
      const guard = (event, destination) => {
        try {
          this.policy(destination);
        } catch {
          event.preventDefault();
          this.error = 'Navigation blocked: use a public HTTPS website.';
          this.emit();
        }
      };
      contents.on('will-navigate', guard);
      contents.on('will-redirect', guard);
      contents.on('will-attach-webview', (event) => event.preventDefault());
      contents.setWindowOpenHandler(({ url: destination }) => {
        try {
          const valid = this.policy(destination);
          void contents.loadURL(valid).catch(() => {});
        } catch {}
        return { action: 'deny' };
      });
      for (const name of [
        'did-start-loading',
        'did-stop-loading',
        'did-navigate',
        'did-navigate-in-page',
        'page-title-updated',
      ])
        contents.on(name, () => this.emit());
      contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        if (mainFrame && code !== -3) {
          this.error = 'Could not load this website. Check the address or try again.';
          this.emit();
        }
      });
      contents.on('render-process-gone', () => {
        this.close();
        this.error = 'Browser paused. Open the page again.';
        this.emit();
      });
    }
    this.setBounds(bounds);
    const contents = this.view.webContents;
    // Do not block IPC for slow websites. Errors become visible state.
    void contents.loadURL(target).catch(() => {});
    this.emit();
    return this.state();
  }
  setBounds(bounds) {
    if (!this.view) return;
    this.view.setBounds(browserBounds(bounds, this.getWindow().getContentSize()));
  }
  navigate(action) {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) return this.state();
    if (action === 'back' && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack();
    else if (action === 'forward' && contents.navigationHistory.canGoForward())
      contents.navigationHistory.goForward();
    else if (action === 'reload') contents.reload();
    else if (!['back', 'forward', 'reload'].includes(action))
      throw new Error('Unknown browser action.');
    return this.state();
  }
  async snapshot() {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error('Open a website first.');
    const current = contents.getURL();
    const url = new URL(this.policy(current));
    url.search = '';
    url.hash = '';
    const text = await contents.executeJavaScriptInIsolatedWorld(1001, [
      { code: visibleTextScript },
    ]);
    if (
      this.view?.webContents !== contents ||
      contents.isDestroyed() ||
      contents.getURL() !== current
    )
      throw new Error('The page changed. Review it again before sharing.');
    return {
      projectId: this.projectId,
      url: url.href,
      title: redact(contents.getTitle().slice(0, 200)),
      text: redact(String(text).slice(0, 20000)),
    };
  }
  hideForReview(hidden) {
    this.view?.setVisible(!hidden);
  }
  suspendSoon() {
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => this.close(), 60_000);
    this.suspendTimer.unref();
  }
  resumeVisible() {
    clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }
  close() {
    this.resumeVisible();
    const view = this.view;
    this.view = null;
    this.projectId = '';
    this.error = '';
    if (view) {
      const win = this.getWindow();
      if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
    this.emit();
    return this.state();
  }
}

module.exports = { ProjectBrowser, browserUrl, browserBounds };
