export const sadeProjectKinds = ['paper-and-slides', 'storefront', 'sales-dashboard'] as const;
export type SadeProjectKind = (typeof sadeProjectKinds)[number];
export type SadeProjectStage = 'preparation' | 'roadmap' | 'delivery' | 'audit' | 'complete';

export interface SadeProjectArtifact {
  id: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface SadeProjectTask {
  stage: 'preparation' | 'delivery' | 'audit';
  outputs: string[];
}

export interface SadeProjectMessage {
  id: string;
  createdAt: string;
  author: string;
  taskKey?: string;
  to?: string;
  kind: 'decision' | 'progress' | 'question' | 'handoff' | 'scope' | 'audit';
  text: string;
  sessionId?: string;
}

export interface SadeProjectSession {
  taskKey: string;
  id: string;
  provider: string;
  status: string;
  activity: { id: string; role: 'assistant' | 'status'; text: string; at: string }[];
}

export interface SadeProjectView {
  kind: SadeProjectKind;
  stage: SadeProjectStage;
  title: string;
  summary: string;
  messages: SadeProjectMessage[];
  sessions: SadeProjectSession[];
  artifacts: SadeProjectArtifact[];
}

export interface SadeProjectContext {
  tasks: {
    key: string;
    title: string;
    harness: string;
    owner: string;
    state: string;
    scope: string[];
    after: string[];
    sessionId?: string;
    activity?: SadeProjectSession['activity'];
    summary?: string;
  }[];
  messages: SadeProjectMessage[];
}

export interface SadeProjectDelivery {
  runId: string;
  kind: SadeProjectKind;
  stage: SadeProjectTask['stage'];
  outputs: string[];
  inputs: SadeProjectArtifact[];
  context: SadeProjectContext;
  resumeJobId?: string;
}

export const sadeProjectFileRoute = '/api/desktop/sade-project-file';
export const sadeProjectChunkBytes = 512 * 1024;
export const sadeProjectFileMaxBytes = 8 * 1024 * 1024;
export const sadeProjectCatalogueMaxBytes = 256 * 1024;
