'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'relayDesktop',
  Object.freeze({
    platform: process.platform,
    version: '0.7.2',
    getStatus: () => ipcRenderer.invoke('relay:status'),
    onStatus: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('relay:status-changed', listener);
      return () => ipcRenderer.removeListener('relay:status-changed', listener);
    },
    beginSignIn: () => ipcRenderer.invoke('relay:sign-in'),
    cancelSignIn: () => ipcRenderer.invoke('relay:cancel-sign-in'),
    groups: (input) => ipcRenderer.invoke('relay:groups', input),
    signOut: () => ipcRenderer.invoke('relay:sign-out'),
    openExternal: (url) => ipcRenderer.invoke('relay:external', url),
    openPreview: (url) => ipcRenderer.invoke('relay:preview', url),
    chooseDirectory: () => ipcRenderer.invoke('relay:directory'),
    joinMachine: () => ipcRenderer.invoke('relay:join-machine'),
    stopMachine: (id) => ipcRenderer.invoke('relay:stop-machine', id),
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
