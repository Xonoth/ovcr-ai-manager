// ===== Stockage des comptes (métadonnées) — chiffré avec safeStorage =====
//
// Jusqu'en 1.0.4, la liste des comptes (noms, e-mails, profils, cooldowns)
// vivait EN CLAIR dans le localStorage du renderer. Elle est désormais tenue
// par le processus principal, dans <userData> :
//   accounts.json       génération courante
//   accounts.json.bak   génération précédente (récupération si corruption)
//   backups/            sauvegarde faite AVANT la migration depuis localStorage
// Chaque fichier est une enveloppe JSON dont la charge utile est chiffrée par
// safeStorage (DPAPI sous Windows : seul ce compte Windows peut la relire).
// Si le chiffrement est indisponible, la charge utile est écrite en clair
// (encryption: "none") et rechiffrée dès qu'il redevient disponible.
//
// Le renderer n'écrit plus jamais ces fichiers : il envoie la liste, le
// processus principal la VALIDE (types, tailles, formats) avant d'écrire.
//
// Ce que ça ne protège PAS : les cookies de session des services IA
// (Partitions/), gérés par Chromium — voir SECURITY.md.
//
// Retour arrière : lancer l'app avec --revert-storage-migration réécrit les
// comptes dans le localStorage (format 1.0.4), met les fichiers de côté (sans
// les supprimer) et quitte. La 1.0.4 peut alors être réinstallée.

const { app, safeStorage } = require('electron');
const path = require('path');
const fsp = require('fs').promises;

const FORMAT = 'ovcr-accounts';
const VERSION = 1;
const MAIN_FILE = 'accounts.json';
const BAK_FILE = 'accounts.json.bak';
const BACKUP_DIR = 'backups';
const MAX_RAW_CHARS = 5 * 1024 * 1024;
const MAX_ACCOUNTS = 1000;
const MAX_SERVICES = 64;
const REVERT_FLAG = '--revert-storage-migration';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SERVICE_ID = /^[a-z0-9_-]{1,40}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;

const file = name => path.join(app.getPath('userData'), name);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// Les opérations disque s'enchaînent une par une, dans l'ordre d'arrivée
// (jamais deux écritures en parallèle sur les mêmes fichiers).
let queue = Promise.resolve();
let pending = 0;
function serial(fn) {
  pending++;
  const run = queue.then(fn, fn);
  queue = run.catch(() => {}).then(() => { pending--; });
  return run;
}

// Permet au processus principal de ne pas quitter au milieu d'une écriture.
const isIdle = () => pending === 0;
const whenIdle = () => queue;

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function encode(raw) {
  const base = { format: FORMAT, version: VERSION, savedAt: new Date().toISOString() };
  if (canEncrypt()) {
    return { ...base, encryption: 'safeStorage', payload: safeStorage.encryptString(raw).toString('base64') };
  }
  console.warn('[accounts] chiffrement safeStorage indisponible : écriture en clair');
  return { ...base, encryption: 'none', payload: raw };
}

async function decodeFile(filePath) {
  let text;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    return { status: err.code === 'ENOENT' ? 'missing' : 'corrupt' };
  }
  let env;
  try { env = JSON.parse(text); } catch (_) { return { status: 'corrupt' }; }
  if (!env || env.format !== FORMAT || typeof env.payload !== 'string') return { status: 'corrupt' };
  if (env.encryption === 'none') return { status: 'ok', raw: env.payload, encryption: 'none' };
  if (env.encryption === 'safeStorage') {
    try {
      return { status: 'ok', raw: safeStorage.decryptString(Buffer.from(env.payload, 'base64')), encryption: 'safeStorage' };
    } catch (_) {
      return { status: 'undecryptable' };
    }
  }
  return { status: 'corrupt' };
}

// Écriture atomique : fichier temporaire synchronisé sur disque puis renommé.
// Une coupure en plein milieu laisse l'ancienne version intacte.
async function writeAtomic(filePath, obj) {
  const tmp = filePath + '.tmp';
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(JSON.stringify(obj), 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, filePath);
}

async function moveAside(filePath, label) {
  try {
    await fsp.rename(filePath, `${filePath.replace(/\.json(\.bak)?$/, '')}.${label}-${stamp()}.json`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ------------------------------------------------------------ Validation --

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (v == null ? '' : String(v)).slice(0, max);

// Normalise un compte. strict = données à ENREGISTRER (venues du renderer) :
// un profil invalide fait refuser l'enregistrement (le profil désigne la
// partition de cookies : on ne le « répare » jamais en silence). En lecture,
// on reste tolérant pour ne jamais perdre un compte existant.
function sanitizeAccount(a, index, strict) {
  if (!isPlainObject(a)) return strict ? { error: 'compte invalide' } : null;

  let id = typeof a.id === 'string' ? a.id : '';
  if (!id || id.length > 100 || CONTROL_CHARS.test(id)) {
    if (strict) return { error: 'identifiant invalide' };
    id = `acc_restored_${Date.now()}_${index}`;
  }

  const profile = typeof a.profile === 'string' ? a.profile : (a.profile == null ? '' : String(a.profile));
  if (strict && (!profile || profile.length > 200 || CONTROL_CHARS.test(profile))) return { error: 'profil invalide' };

  const services = Array.isArray(a.services)
    ? [...new Set(a.services.filter(s => typeof s === 'string' && SERVICE_ID.test(s)))].slice(0, MAX_SERVICES)
    : undefined; // absent : la migration du renderer rattache tous les services

  let cooldowns;
  if (isPlainObject(a.cooldowns)) {
    cooldowns = {};
    for (const [k, v] of Object.entries(a.cooldowns).slice(0, MAX_SERVICES)) {
      if (!SERVICE_ID.test(k)) continue;
      cooldowns[k] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    }
  }

  const acc = { id, name: text(a.name, 200), email: text(a.email, 320), profile };
  if (typeof a.color === 'string' && COLOR.test(a.color)) acc.color = a.color;
  if (services) acc.services = services;
  if (cooldowns) acc.cooldowns = cooldowns;
  return { account: acc };
}

function sanitizeList(list, strict) {
  if (!Array.isArray(list)) return { error: 'liste invalide' };
  if (list.length > MAX_ACCOUNTS) return { error: 'trop de comptes' };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const r = sanitizeAccount(list[i], i, strict);
    if (!r) continue;
    if (r.error) return { error: r.error };
    out.push(r.account);
  }
  return { accounts: out };
}

// JSON brut -> comptes (lecture tolérante). null si JSON illisible. Un JSON
// valide mais qui n'est pas un tableau donne une liste vide (comme en 1.0.4).
function parseRaw(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (_) { return null; }
  if (!Array.isArray(data)) return [];
  return sanitizeList(data, false).accounts || [];
}

async function backupInfo() {
  const b = await decodeFile(file(BAK_FILE));
  const list = b.status === 'ok' ? parseRaw(b.raw) : null;
  return { available: !!list, count: list ? list.length : 0 };
}

// --------------------------------------------------------------- API --

function load() {
  return serial(async () => {
    const cur = await decodeFile(file(MAIN_FILE));
    if (cur.status === 'missing') return { status: 'empty', accounts: [] };
    if (cur.status === 'ok') {
      const accounts = parseRaw(cur.raw);
      if (accounts === null) return { status: 'corrupt', backup: await backupInfo() };
      // Écrit en clair faute de chiffrement lors d'un lancement précédent :
      // on rechiffre dès que c'est possible.
      if (cur.encryption === 'none' && canEncrypt()) {
        await writeAtomic(file(MAIN_FILE), encode(cur.raw)).catch(() => {});
      }
      return { status: 'ok', accounts, encrypted: canEncrypt() };
    }
    // corrompu, ou chiffré par un autre compte Windows / clé DPAPI perdue
    return { status: cur.status === 'undecryptable' ? 'undecryptable' : 'corrupt', backup: await backupInfo() };
  });
}

function save(list) {
  const r = sanitizeList(list, true);
  if (r.error) return Promise.resolve({ ok: false, error: r.error });
  const raw = JSON.stringify(r.accounts);
  if (raw.length > MAX_RAW_CHARS) return Promise.resolve({ ok: false, error: 'données trop volumineuses' });
  return serial(async () => {
    const mainPath = file(MAIN_FILE);
    const cur = await decodeFile(mainPath);
    if (cur.status === 'ok' && parseRaw(cur.raw) !== null) {
      // Génération précédente valide -> devient la sauvegarde.
      await fsp.copyFile(mainPath, file(BAK_FILE));
    } else if (cur.status !== 'missing') {
      // Fichier actuel illisible : mis de côté (jamais détruit), et la
      // sauvegarde existante, elle, est préservée.
      await moveAside(mainPath, 'unreadable');
    }
    await writeAtomic(mainPath, encode(raw));
    return { ok: true, encrypted: canEncrypt() };
  }).catch(err => {
    console.error('[accounts] échec d\'enregistrement :', err.code || err.message);
    return { ok: false, error: 'écriture impossible' };
  });
}

function restoreBackup() {
  return serial(async () => {
    const b = await decodeFile(file(BAK_FILE));
    const accounts = b.status === 'ok' ? parseRaw(b.raw) : null;
    if (!accounts) return { ok: false, error: 'aucune sauvegarde lisible' };
    await moveAside(file(MAIN_FILE), 'unreadable');
    await fsp.copyFile(file(BAK_FILE), file(MAIN_FILE));
    return { ok: true, accounts };
  }).catch(err => ({ ok: false, error: err.code || err.message }));
}

// Migration depuis le localStorage de la 1.0.4. Les chaînes brutes sont
// reprises TELLES QUELLES (même corrompues : la récupération par la
// sauvegarde reste possible exactement comme avant). Étapes :
//   1. sauvegarde préalable chiffrée de l'état d'origine (backups/) ;
//   2. écriture de accounts.json(.bak) ;
//   3. relecture et comparaison octet à octet ; en cas d'écart, on annule.
// Le renderer n'efface le localStorage qu'après un succès.
function migrateLegacy(payload) {
  const current = payload && payload.current;
  const backup = payload && payload.backup;
  const okStr = v => v == null || (typeof v === 'string' && v.length <= MAX_RAW_CHARS);
  if (!isPlainObject(payload) || !okStr(current) || !okStr(backup)) return Promise.resolve({ ok: false, error: 'invalid' });
  if (current == null && backup == null) return Promise.resolve({ ok: false, error: 'nothing' });

  return serial(async () => {
    if ((await decodeFile(file(MAIN_FILE))).status !== 'missing') return { ok: false, error: 'exists' };

    await fsp.mkdir(file(BACKUP_DIR), { recursive: true });
    const preFile = path.join(file(BACKUP_DIR), `pre-migration-${stamp()}.json`);
    const preRaw = JSON.stringify({
      source: 'localStorage (1.0.4)', createdAt: new Date().toISOString(),
      keys: { ai_accounts: current == null ? null : current, ai_accounts_backup: backup == null ? null : backup }
    });
    await writeAtomic(preFile, encode(preRaw));

    const written = [[preFile, preRaw]];
    if (backup != null) { await writeAtomic(file(BAK_FILE), encode(backup)); written.push([file(BAK_FILE), backup]); }
    if (current != null) { await writeAtomic(file(MAIN_FILE), encode(current)); written.push([file(MAIN_FILE), current]); }

    for (const [p, expected] of written) {
      const back = await decodeFile(p);
      if (back.status !== 'ok' || back.raw !== expected) {
        await fsp.rm(file(MAIN_FILE), { force: true });
        await fsp.rm(file(BAK_FILE), { force: true });
        return { ok: false, error: 'verify' };
      }
    }
    return { ok: true, encrypted: canEncrypt(), backupFile: path.basename(preFile) };
  }).catch(err => {
    console.error('[accounts] migration impossible :', err.code || err.message);
    return { ok: false, error: 'write_failed' };
  });
}

// ------------------------------------------------------ Retour arrière --

const revertRequested = () => process.argv.includes(REVERT_FLAG);

function pendingRevert() {
  if (!revertRequested()) return Promise.resolve(null);
  return serial(async () => {
    const cur = await decodeFile(file(MAIN_FILE));
    const bak = await decodeFile(file(BAK_FILE));
    if (cur.status === 'missing' && bak.status === 'missing') return { ok: false, error: 'nothing' };
    if (cur.status === 'undecryptable') return { ok: false, error: 'undecryptable' };
    return {
      ok: true,
      current: cur.status === 'ok' ? cur.raw : null,
      backup: bak.status === 'ok' ? bak.raw : null
    };
  });
}

function confirmRevert() {
  if (!revertRequested()) return Promise.resolve({ ok: false, error: 'not_requested' });
  return serial(async () => {
    await moveAside(file(MAIN_FILE), 'reverted');
    try {
      await fsp.rename(file(BAK_FILE), file(`accounts.bak.reverted-${stamp()}.json`));
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return { ok: true };
  }).catch(err => ({ ok: false, error: err.code || err.message }));
}

module.exports = {
  load, save, restoreBackup, migrateLegacy, pendingRevert, confirmRevert, revertRequested,
  isIdle, whenIdle,
  _test: { sanitizeList, parseRaw }
};
