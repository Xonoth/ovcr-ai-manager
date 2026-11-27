// Electron simulé pour les tests unitaires (node --test, sans Electron).
//
// Usage : const fake = require('../helpers/fake-electron'); AVANT de charger
// un module de l'app. Toute requête require('electron') reçoit alors cet
// objet. Les modules de l'app relisent app.getPath('userData') à chaque
// opération : fake.useTempUserData() suffit à isoler chaque test.
//
// safeStorage simulé : « chiffrement » réversible ENC:<base64> — suffisant pour
// tester l'enveloppe, la détection d'un fichier indéchiffrable (autre clé) et
// le mode dégradé « chiffrement indisponible ».

const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const state = {
  userData: null,
  encryptionAvailable: true,
  keyId: 'cle-A',          // changer de clé = fichier écrit par un autre compte Windows
  openDialogResult: { canceled: true, filePaths: [] },
  messageBoxResponse: { response: 1, checkboxChecked: false },
  messageBoxCalls: []
};

const app = new EventEmitter();
app.getPath = (name) => {
  if (name === 'userData' || name === 'appData') return state.userData;
  return os.tmpdir();
};
app.setPath = () => {};
app.getVersion = () => '0.0.0-test';

const safeStorage = {
  isEncryptionAvailable: () => state.encryptionAvailable,
  encryptString(s) {
    if (!state.encryptionAvailable) throw new Error('indisponible');
    return Buffer.from(`ENC:${state.keyId}:` + Buffer.from(s, 'utf8').toString('base64'), 'utf8');
  },
  decryptString(buf) {
    const t = buf.toString('utf8');
    const prefix = `ENC:${state.keyId}:`;
    if (!t.startsWith(prefix)) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
    return Buffer.from(t.slice(prefix.length), 'base64').toString('utf8');
  }
};

const dialog = {
  showOpenDialog: async () => state.openDialogResult,
  showMessageBox: async (...args) => {
    state.messageBoxCalls.push(args[args.length - 1]);
    return state.messageBoxResponse;
  }
};

const BrowserWindow = {
  fromWebContents: () => null,
  getFocusedWindow: () => null,
  getAllWindows: () => []
};

const shell = { openExternal: async () => {}, openPath: async () => '' };

const electron = { app, safeStorage, dialog, BrowserWindow, shell };

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electron;
  return originalLoad.call(this, request, ...rest);
};

// Crée un dossier userData vide et propre pour un test ; renvoie son chemin.
function useTempUserData() {
  state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-test-'));
  return state.userData;
}

function cleanup() {
  if (state.userData) fs.rmSync(state.userData, { recursive: true, force: true });
}

function reset() {
  state.encryptionAvailable = true;
  state.keyId = 'cle-A';
  state.openDialogResult = { canceled: true, filePaths: [] };
  state.messageBoxResponse = { response: 1, checkboxChecked: false };
  state.messageBoxCalls = [];
}

// Charge un module de l'app « neuf » (état interne remis à zéro).
function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

module.exports = { electron, state, useTempUserData, cleanup, reset, freshRequire };
