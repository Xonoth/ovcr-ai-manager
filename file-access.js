// ===== Accès aux fichiers locaux (explorateur + éditeur intégré) =====
//
// Toutes les opérations sur le disque demandées par l'interface passent par
// ce module, côté processus PRINCIPAL. Le renderer ne touche jamais au disque
// lui-même et n'est jamais cru sur parole :
//   - un dossier ne devient accessible qu'après avoir été choisi par
//     l'utilisateur dans la boîte « Choisir un dossier » (racines autorisées) ;
//   - chaque chemin reçu est normalisé, puis résolu (realpath : liens
//     symboliques / jonctions suivis) et doit rester DANS une racine autorisée
//     (aucune traversée « ..\ », aucun lien qui pointe en dehors) ;
//   - lecture : fichiers réguliers uniquement, 20 Mo max, binaires refusés,
//     fichiers non UTF-8 ouverts en lecture seule (les réenregistrer en UTF-8
//     les abîmerait) ;
//   - écriture : seulement un fichier OUVERT au préalable dans l'éditeur
//     (impossible de créer ou d'écraser un fichier arbitraire), 20 Mo max.

const { dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;

// Taille max d'un fichier ouvrable/enregistrable dans l'éditeur. Au-delà, lire
// le fichier entier en mémoire + le transférer par IPC figerait main ET renderer.
const MAX_EDITABLE_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo
const MAX_PATH_LENGTH = 4096;
const MAX_ROOTS = 32;
const MAX_TRACKED_FILES = 2000;
const MAX_LISTED_ENTRIES = 5000;
const BINARY_SNIFF_BYTES = 8000;
const IGNORED_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache']);

const IS_WIN = process.platform === 'win32';
const keyOf = p => (IS_WIN ? p.toLowerCase() : p);

// Racines choisies par l'utilisateur pendant cette session (chemins réels).
const roots = [];
// Fichiers ouverts dans l'éditeur et enregistrables : clé (chemin réel) -> true.
const editableFiles = new Map();

function remember(map, key) {
  map.delete(key);
  map.set(key, true);
  if (map.size > MAX_TRACKED_FILES) map.delete(map.keys().next().value);
}

// Contrôle de forme d'un chemin venu du renderer, puis normalisation.
// Renvoie null si le chemin est refusé d'office.
function normalizeInput(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATH_LENGTH) return null;
  if (p.includes('\0')) return null;
  if (!path.isAbsolute(p)) return null;
  // Espaces de noms de périphériques Windows (\\?\, \\.\) : jamais légitimes ici.
  if (IS_WIN && /^[\\/]{2}[?.][\\/]/.test(p)) return null;
  return path.resolve(p); // résout « . », « .. », séparateurs multiples
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // autre lecteur
  return rel !== '..' && !rel.startsWith('..' + path.sep);
}

// Chemin normalisé + réel (liens suivis) d'une cible, à condition qu'elle
// soit dans une racine autorisée. null sinon (inexistant, hors racine…).
async function resolveAllowed(p) {
  const normalized = normalizeInput(p);
  if (!normalized) return null;
  let real;
  try { real = await fsp.realpath(normalized); } catch (_) { return null; }
  const ok = roots.some(root => isInside(root, real));
  return ok ? { normalized, real } : null;
}

async function selectFolder(parentWindow) {
  const options = { properties: ['openDirectory'] };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = path.resolve(result.filePaths[0]);
  let real;
  try { real = await fsp.realpath(chosen); } catch (_) { return null; }
  if (!roots.some(r => keyOf(r) === keyOf(real))) {
    roots.push(real);
    if (roots.length > MAX_ROOTS) roots.shift();
  }
  return chosen;
}

async function listDirectory(dirPath) {
  const target = await resolveAllowed(dirPath);
  if (!target) return { ok: false, error: 'denied', entries: [] };
  try {
    const dirents = await fsp.readdir(target.real, { withFileTypes: true });
    const entries = dirents
      .filter(d => d.isFile() && !IGNORED_NAMES.has(d.name))
      .slice(0, MAX_LISTED_ENTRIES)
      .map(d => ({ name: d.name, path: path.join(target.normalized, d.name) }));
    return { ok: true, entries };
  } catch (_) {
    return { ok: false, error: 'unreadable', entries: [] };
  }
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Lossy = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

async function readFile(filePath) {
  const target = await resolveAllowed(filePath);
  if (!target) return { ok: false, error: 'denied' };
  try {
    const stat = await fsp.stat(target.real);
    if (!stat.isFile()) return { ok: false, error: 'denied' };
    // Garde-fou taille : un gros fichier lu en entier figerait l'app.
    if (stat.size > MAX_EDITABLE_FILE_BYTES) return { ok: false, error: 'too_large', size: stat.size, limit: MAX_EDITABLE_FILE_BYTES };
    const buf = await fsp.readFile(target.real);
    // Octet nul dans le début du fichier : binaire (image, exe, zip…). Ouvert
    // en texte puis enregistré, il serait détruit.
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { ok: false, error: 'binary' };
    let content;
    let readOnly = false;
    try {
      content = utf8Strict.decode(buf); // ignoreBOM: true -> le BOM est conservé tel quel
    } catch (_) {
      content = utf8Lossy.decode(buf);  // ex. fichier Latin-1 : lisible, pas réenregistrable
      readOnly = true;
    }
    const key = keyOf(target.real);
    if (readOnly) editableFiles.delete(key);
    else remember(editableFiles, key);
    return { ok: true, content, readOnly };
  } catch (_) {
    return { ok: false, error: 'unreadable' };
  }
}

async function saveFile(filePath, content) {
  if (typeof content !== 'string') return { ok: false, error: 'invalid' };
  if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_BYTES) return { ok: false, error: 'too_large' };
  const target = await resolveAllowed(filePath);
  if (!target || !editableFiles.has(keyOf(target.real))) return { ok: false, error: 'denied' };
  try {
    const stat = await fsp.stat(target.real);
    if (!stat.isFile()) return { ok: false, error: 'denied' };
    await fsp.writeFile(target.real, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    console.error('[files] erreur d\'enregistrement :', err.code || err.message);
    return { ok: false, error: 'write_failed' };
  }
}

module.exports = {
  selectFolder, listDirectory, readFile, saveFile,
  MAX_EDITABLE_FILE_BYTES,
  _test: { normalizeInput, isInside, roots, editableFiles }
};
