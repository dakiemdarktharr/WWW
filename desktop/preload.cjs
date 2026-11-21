'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const versionArgument = process.argv.find((argument) => argument.startsWith('--kivuno-version='));

contextBridge.exposeInMainWorld(
  'relayDesktop',
  Object.freeze({
    platform: process.platform,
    version: versionArgument?.slice('--kivuno-version='.length) || '0.0.0',
    checkForUpdates: () => ipcRenderer.invoke('relay:update-status'),
    installUpdate: (version) => ipcRenderer.invoke('relay:update-install', version),
    onUpdateProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('relay:update-progress', listener);
      return () => ipcRenderer.removeListener('relay:update-progress', listener);
    },
    getStatus: () => ipcRenderer.invoke('relay:status'),
    onStatus: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('relay:status-changed', listener);
      return () => ipcRenderer.removeListener('relay:status-changed', listener);
    },
    beginSignIn: () => ipcRenderer.invoke('relay:sign-in'),
    cancelSignIn: () => ipcRenderer.invoke('relay:cancel-sign-in'),
    claudeClient: (action) => ipcRenderer.invoke('relay:claude-client', action),
    prepareProvider: (provider) => ipcRenderer.invoke('relay:prepare-provider', provider),
    signInAntigravityWithGoogle: () => ipcRenderer.invoke('relay:antigravity-google-sign-in'),
    groups: (input) => ipcRenderer.invoke('relay:groups', input),
    beginClaudeWebAccount: (input) => ipcRenderer.invoke('relay:claude-web-begin', input),
    claudeWebAccountStatus: (input) => ipcRenderer.invoke('relay:claude-web-status', input),
    createClaudeWebConnection: (input) => ipcRenderer.invoke('relay:claude-web-create', input),
    revokeClaudeWebConnection: (id) => ipcRenderer.invoke('relay:claude-web-revoke', id),
    projectDeliverable: (input) => ipcRenderer.invoke('relay:project-deliverable', input),
    sadeDecks: (input) => ipcRenderer.invoke('relay:sade-decks', input),
    projectCatalogue: (input) => ipcRenderer.invoke('relay:project-catalogue', input),
    projectPreview: (input) => ipcRenderer.invoke('relay:project-preview', input),
    profiles: (input) => ipcRenderer.invoke('relay:profiles', input),
    signOut: () => ipcRenderer.invoke('relay:sign-out'),
    openExternal: (url) => ipcRenderer.invoke('relay:external', url),
    openPreview: (url) => ipcRenderer.invoke('relay:preview', url),
    chooseDirectory: () => ipcRenderer.invoke('relay:directory'),
    joinMachine: () => ipcRenderer.invoke('relay:join-machine'),
    stopMachine: (id) => ipcRenderer.invoke('relay:stop-machine', id),
    workspaceTheme: (value) => ipcRenderer.invoke('relay:workspace-theme', value),
    getWindowState: () => ipcRenderer.invoke('relay:window-state'),
    controlWindow: (action) => ipcRenderer.invoke('relay:window-control', action),
    onWindowState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('relay:window-state', listener);
      return () => ipcRenderer.removeListener('relay:window-state', listener);
    },
    browser: Object.freeze({
      state: () => ipcRenderer.invoke('relay:browser-state'),
      open: (input) => ipcRenderer.invoke('relay:browser-open', input),
      bounds: (input) => ipcRenderer.invoke('relay:browser-bounds', input),
      navigate: (action) => ipcRenderer.invoke('relay:browser-navigate', action),
      snapshot: () => ipcRenderer.invoke('relay:browser-snapshot'),
      review: (hidden) => ipcRenderer.invoke('relay:browser-review', hidden),
      close: () => ipcRenderer.invoke('relay:browser-close'),
      onState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('relay:browser-state', listener);
        return () => ipcRenderer.removeListener('relay:browser-state', listener);
      },
    }),
  }),
);
