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

declare global {
  interface Window {
    relayDesktop?: {
      platform: string;
      version: string;
      getStatus(): Promise<DesktopStatus>;
      beginSignIn(): Promise<DesktopStatus>;
      signOut(): Promise<void>;
      openExternal(url: string): Promise<void>;
      openPreview(url: string): Promise<void>;
      chooseDirectory(): Promise<string | null>;
      joinMachine(): Promise<JoinedMachine | null>;
      stopMachine(id: string): Promise<void>;
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
