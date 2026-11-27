// ===== Écriture atomique de petits fichiers de données (processus principal) =====
//
// Principe : le contenu est écrit dans <fichier>.tmp, forcé sur disque (fsync),
// puis renommé par-dessus le fichier final. Le renommage est atomique sur un
// même volume : à tout instant le fichier final est soit l'ANCIENNE version
// complète, soit la NOUVELLE — jamais un fichier tronqué.
//
// Windows : un antivirus, l'indexeur ou une sauvegarde peut ouvrir brièvement
// le fichier et faire échouer le renommage (EPERM / EBUSY / EACCES). On
// réessaie alors quelques fois avec une courte attente croissante avant
// d'abandonner (l'ancienne version reste intacte dans tous les cas).

const fs = require('fs');
const fsp = fs.promises;

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [20, 50, 100, 200, 400];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (!RETRY_CODES.has(err.code) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Écrit `text` (chaîne) de façon atomique dans filePath.
async function writeAtomicText(filePath, text) {
  const tmp = filePath + '.tmp';
  try {
    const fh = await fsp.open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    // Pas de .tmp orphelin : l'original n'a pas été touché.
    await fsp.rm(tmp, { force: true }).catch(() => { /* déjà absent : rien à nettoyer */ });
    throw err;
  }
}

// Copie src -> dest de façon atomique (dest n'est jamais à moitié écrite,
// contrairement à fs.copyFile).
async function copyAtomic(src, dest) {
  const text = await fsp.readFile(src, 'utf8');
  await writeAtomicText(dest, text);
}

// Version synchrone (petits fichiers de réglages écrits depuis un handler
// synchrone). Mêmes garanties ; l'attente entre deux essais est active mais
// bornée (< 1 s au total, uniquement en cas de fichier verrouillé).
function writeAtomicTextSync(filePath, text) {
  const tmp = filePath + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, filePath);
        break;
      } catch (err) {
        if (!RETRY_CODES.has(err.code) || attempt >= RETRY_DELAYS_MS.length) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAYS_MS[attempt]);
      }
    }
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* déjà absent */ }
    throw err;
  }
}

// Horodatage utilisable dans un nom de fichier Windows (pas de « : »).
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

module.exports = { writeAtomicText, writeAtomicTextSync, copyAtomic, renameWithRetry, fileStamp, RETRY_CODES };
