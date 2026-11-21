export interface JoinedMachine {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'recovery';
  error?: string;
}

export interface DesktopStatus {
  signedIn: boolean;
  owner?: { id: string; name: string; email?: string };
  pending?: { userCode: string; verificationUri: string; expiresAt: string };
  error?: string;
  runtime: 'starting' | 'ready' | 'stopped';
  cloudOrigin: string;
  machines?: JoinedMachine[];
}

export interface DesktopWindowState {
  maximized: boolean;
  fullscreen: boolean;
}
export type DesktopProfileCommand =
  | {
      action: 'reserve';
      profileId: string;
      name: string;
      provider: import('../shared/types').ProviderId;
    }
  | {
      action: 'commit';
      profileId: string;
      name?: string;
      provider?: import('../shared/types').ProviderId;
    }
  | { action: 'release'; profileId: string }
  | {
      action: 'sync';
      profiles: {
        profileId: string;
        name: string;
        provider: import('../shared/types').ProviderId;
      }[];
    };
export interface DesktopUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  downloadAvailable: boolean;
  lastInstallFailed: boolean;
}
export type DesktopUpdateProgress =
  { phase: 'downloading'; percent: number } | { phase: 'installing' };
export interface BrowserState {
  active: boolean;
  projectId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string;
}
export interface BrowserPage {
  projectId: string;
  url: string;
  title: string;
  text: string;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    relayDesktop?: {
      platform: string;
      version: string;
      checkForUpdates(): Promise<DesktopUpdateStatus>;
      installUpdate(version: string): Promise<void>;
      onUpdateProgress(callback: (progress: DesktopUpdateProgress) => void): () => void;
      getStatus(): Promise<DesktopStatus>;
      onStatus(callback: (status: DesktopStatus) => void): () => void;
      beginSignIn(): Promise<DesktopStatus>;
      cancelSignIn(): Promise<DesktopStatus>;
      prepareProvider(provider: import('../shared/types').ProviderId): Promise<{
        provider: import('../shared/types').ProviderId;
        installed: boolean;
      }>;
      signInAntigravityWithGoogle(): Promise<void>;
      groups<T>(input: import('../shared/collaboration').GroupCommand): Promise<T>;
      projectDeliverable(input: {
        groupId: string;
        runId: string;
        fileId: string;
      }): Promise<string>;
      projectCatalogue(input: {
        groupId: string;
        runId: string;
        projectKey: string;
        data: string;
      }): Promise<void>;
      projectPreview(input: { groupId: string; runId: string; fileId: string }): Promise<void>;
      profiles<T>(input: DesktopProfileCommand): Promise<T>;
      signOut(): Promise<void>;
      openExternal(url: string): Promise<void>;
      openPreview(url: string): Promise<void>;
      chooseDirectory(): Promise<string | null>;
      joinMachine(): Promise<JoinedMachine | null>;
      stopMachine(id: string): Promise<void>;
      getWindowState(): Promise<DesktopWindowState>;
      controlWindow(
        action: 'minimize' | 'maximize' | 'fullscreen' | 'close',
      ): Promise<DesktopWindowState>;
      onWindowState(callback: (state: DesktopWindowState) => void): () => void;
      browser: {
        state(): Promise<BrowserState>;
        open(input: {
          projectId: string;
          url: string;
          bounds: BrowserBounds;
        }): Promise<BrowserState>;
        bounds(input: BrowserBounds): Promise<void>;
        navigate(action: 'back' | 'forward' | 'reload'): Promise<BrowserState>;
        snapshot(): Promise<BrowserPage>;
        review(hidden: boolean): Promise<void>;
        close(): Promise<BrowserState>;
        onState(callback: (state: BrowserState) => void): () => void;
      };
    };
  }
}

export async function openExternal(url: string) {
  if (window.relayDesktop) await window.relayDesktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPreview(url: string) {
  if (window.relayDesktop) await window.relayDesktop.openPreview(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
