// ===== Preload de la fenêtre hôte (interface de l'app) =====
//
// La page tourne SANS Node.js (nodeIntegration: false), dans un monde isolé
// (contextIsolation: true) et sandboxée. Ce preload est le seul pont vers le
// processus principal : il expose sous window.ovcr une liste FERMÉE de
// méthodes, une par opération. Jamais d'ipcRenderer, de require, de process,
// ni de fonction « envoyer sur n'importe quel canal ».
//
// Les paramètres sont transmis tels quels : c'est le processus principal qui
// les valide (types, chemins, tailles) et qui vérifie que l'appel vient bien
// de la page locale de l'app. Aucun contrôle fait ici n'est considéré suffisant.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ovcr', {
  files: {
    // Boîte « Choisir un dossier » ; renvoie le chemin choisi (ou null).
    selectFolder: invoke('files:select-folder'),
    listDirectory: invoke('files:list-directory'),
    readFile: invoke('files:read'),
    saveFile: invoke('files:save')
  },
  accounts: {
    load: invoke('accounts:load'),
    save: invoke('accounts:save'),
    restoreBackup: invoke('accounts:restore-backup'),
    migrateLegacy: invoke('accounts:migrate-legacy')
  },
  storage: {
    pendingRevert: invoke('storage:pending-revert'),
    confirmRevert: invoke('storage:confirm-revert')
  },
  sitePermissions: {
    reset: invoke('site-permissions:reset')
  },
  services: {
    // Ouvre l'adresse d'un service (https, liste blanche vérifiée côté main)
    // dans le navigateur système.
    openInBrowser: invoke('services:open-in-browser')
  },
  diag: {
    // { level: 'info'|'warn'|'error', message, stack } — expurgé et limité côté main.
    report: invoke('diag:report'),
    get: invoke('diag:get'),
    openLogs: invoke('diag:open-logs')
  }
});
