'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'relayDesktop',
  Object.freeze({
    platform: process.platform,
    version: '0.3.0',
    getStatus: () => ipcRenderer.invoke('relay:status'),
    beginSignIn: () => ipcRenderer.invoke('relay:sign-in'),
    signOut: () => ipcRenderer.invoke('relay:sign-out'),
    openExternal: (url) => ipcRenderer.invoke('relay:external', url),
    openPreview: (url) => ipcRenderer.invoke('relay:preview', url),
    chooseDirectory: () => ipcRenderer.invoke('relay:directory'),
    joinMachine: () => ipcRenderer.invoke('relay:join-machine'),
    stopMachine: (id) => ipcRenderer.invoke('relay:stop-machine', id),
  }),
);
