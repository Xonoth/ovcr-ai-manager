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
// API ASYNCHRONE de safeStorage depuis la 1.3.0 (Electron 45 déprécie l'API
// synchrone, Electron 46 la supprime). Vérifié entre Electron 43.8.10 et
// 45.3.2 sur un même profil : les deux API produisent le même format (« v10 »,
// même clé rangée dans « Local State »), dans les deux sens. Un retour à la
// 1.2.0 relit donc les fichiers écrits par cette version, et inversement.
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
const { writeAtomicText, copyAtomic, renameWithRetry, fileStamp } = require('./atomic-file');

const FORMAT = 'ovcr-accounts';
// Version du CONTENEUR (forme de l'enveloppe : format/encryption/payload).
const VERSION = 1;

// ===== Versionnement du schéma des comptes (phase 2, lot 2) =====
// `schema` (dans l'enveloppe) = forme des comptes dans la charge utile. Absent
// = 1 (fichiers écrits jusqu'en 1.1.0). La charge utile reste un TABLEAU de
// comptes à tous les schémas : une version antérieure (1.1.0) qui relit un
// fichier plus récent retrouve donc tous les comptes (elle ignore seulement
// les champs qu'elle ne connaît pas) — un retour arrière ne perd aucun compte.
//
// MIGRATIONS[n] : fonction PURE qui reçoit la liste au schéma n (déjà JSON.parse,
// non validée) et renvoie la liste au schéma n+1. Elle doit être IDEMPOTENTE
// et tolérante (une entrée inattendue est laissée telle quelle : la validation
// qui suit tranchera). Avant chaque migration, le fichier d'origine est copié
// tel quel (toujours chiffré) dans backups/pre-schema-v<n>-v<m>-<date>.json.
const SCHEMA = 1;
const MIGRATIONS = {};
let currentSchema = SCHEMA;       // modifiables uniquement par les tests
let migrations = MIGRATIONS;
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
const stamp = fileStamp;

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

// Le chiffreur asynchrone ne s'initialise qu'après app.ready : on l'attend
// toujours (en pratique, tous les appels arrivent par IPC, donc après).
async function canEncrypt() {
  try {
    await app.whenReady();
    return await safeStorage.isAsyncEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

// ===== Clé de chiffrement pas encore écrite sur le disque (profil neuf) =====
// Mesuré en 1.6.0 (Electron 45.3.2, Windows) : sur un profil neuf, la clé de
// safeStorage est créée en mémoire au premier chiffrement, mais Chromium
// n'écrit « Local State », le fichier qui la contient, qu'environ 10 s plus
// tard. Un arrêt brutal dans cet intervalle (plantage, coupure de courant, fin
// de tâche) perdait la clé : au lancement suivant, les comptes étaient
// indéchiffrables. Tant que la clé n'est pas sur le disque, on écrit donc en
// clair (comme quand le chiffrement est indisponible), puis on rechiffre les
// mêmes fichiers dès qu'elle y est. Ne concerne qu'un profil neuf : premier
// lancement, ou migration depuis la 1.0.4 (qui n'avait pas de clé).
// Hors Windows, la clé n'est pas rangée dans « Local State » : pas de contrôle.
const LOCAL_STATE = 'Local State';
const REENCRYPT_MAX_MS = 5 * 60 * 1000;
let keyOnDisk = process.platform !== 'win32';
let reencryptPollMs = 1000;       // modifiable uniquement par les tests
const reencryptPending = new Set();
let reencryptTimer = null;

async function keyIsOnDisk() {
  if (keyOnDisk) return true;
  try {
    const ls = JSON.parse(await fsp.readFile(file(LOCAL_STATE), 'utf8'));
    const key = ls && ls.os_crypt && ls.os_crypt.encrypted_key;
    keyOnDisk = typeof key === 'string' && key.length > 0;
  } catch (_) { /* absent (profil neuf) : on regardera de nouveau plus tard */ }
  return keyOnDisk;
}

// Crée la clé dès le démarrage : elle est alors sur le disque une dizaine de
// secondes plus tard, en général avant le premier enregistrement.
async function prepareKey() {
  if (!(await canEncrypt()) || (await keyIsOnDisk())) return;
  try { await safeStorage.encryptStringAsync('ovcr'); } catch (_) { /* signalé au premier enregistrement */ }
}

// Rechiffre les enveloppes écrites en clair SANS rien changer d'autre (champs,
// date, schéma). Jamais un fichier d'une version plus récente. À appeler dans serial().
async function reencryptPlainFiles(paths) {
  let count = 0;
  for (const p of paths) {
    let env;
    try { env = JSON.parse(await fsp.readFile(p, 'utf8')); } catch (_) { continue; }
    if (!env || env.format !== FORMAT || env.encryption !== 'none' || typeof env.payload !== 'string') continue;
    const schema = schemaOf(env);
    if ((Number.isInteger(env.version) && env.version > VERSION) || schema === null || schema > currentSchema) continue;
    const payload = (await safeStorage.encryptStringAsync(env.payload)).toString('base64');
    await writeAtomic(p, { ...env, encryption: 'safeStorage', payload });
    count++;
  }
  return count;
}

// Rechiffre ces fichiers dès que la clé est sur le disque (vérifié chaque
// seconde, pendant 5 min au plus ; au-delà, le prochain lancement s'en charge).
function reencryptLater(paths) {
  for (const p of paths) reencryptPending.add(p);
  if (reencryptTimer) return;
  const started = Date.now();
  const tick = async () => {
    reencryptTimer = null;
    if (await keyIsOnDisk()) {
      // Les fichiers signalés, plus tous les fichiers de comptes : une
      // rotation a pu copier un fichier en clair vers .bak entre-temps.
      const extra = [...reencryptPending];
      reencryptPending.clear();
      await serial(async () => reencryptPlainFiles([...new Set([file(MAIN_FILE), file(BAK_FILE), ...(await backupFiles()), ...extra])]))
        .then(n => console.log(`[accounts] clé de chiffrement enregistrée sur le disque : ${n} fichier(s) rechiffré(s)`))
        .catch(err => console.warn('[accounts] rechiffrement reporté :', err.code || err.message));
      return;
    }
    if (Date.now() - started > REENCRYPT_MAX_MS) {
      console.warn('[accounts] clé de chiffrement toujours absente du disque : rechiffrement au prochain lancement');
      return;
    }
    reencryptTimer = setTimeout(tick, reencryptPollMs);
    reencryptTimer.unref();
  };
  reencryptTimer = setTimeout(tick, reencryptPollMs);
  reencryptTimer.unref();
}

// schema : version de schéma de la charge utile (omis pour les fichiers qui ne
// contiennent pas une liste de comptes, ex. la sauvegarde pré-migration 1.0.4).
// filePath : fichier qui recevra l'enveloppe (rechiffré plus tard si l'écriture
// est provisoirement en clair).
async function encode(raw, schema, filePath) {
  const base = { format: FORMAT, version: VERSION, savedAt: new Date().toISOString() };
  if (schema !== undefined) base.schema = schema;
  if (await canEncrypt()) {
    if (await keyIsOnDisk()) {
      return { ...base, encryption: 'safeStorage', payload: (await safeStorage.encryptStringAsync(raw)).toString('base64') };
    }
    console.warn('[accounts] clé de chiffrement pas encore enregistrée sur le disque : écriture provisoire en clair');
    if (filePath) reencryptLater([filePath]);
  } else {
    console.warn('[accounts] chiffrement safeStorage indisponible : écriture en clair');
  }
  return { ...base, encryption: 'none', payload: raw };
}

// Fichiers .json de backups/ (vide si le dossier n'existe pas).
async function backupFiles() {
  try {
    return (await fsp.readdir(file(BACKUP_DIR))).filter(f => f.endsWith('.json')).map(f => path.join(file(BACKUP_DIR), f));
  } catch (_) {
    return [];
  }
}

// Enveloppe écrite de façon atomique dans filePath.
const writeEnvelope = async (filePath, raw, schema) => writeAtomic(filePath, await encode(raw, schema, filePath));

// Schéma déclaré par une enveloppe : absent = 1 ; présent mais invalide = null.
function schemaOf(env) {
  if (env.schema === undefined) return 1;
  return Number.isInteger(env.schema) && env.schema >= 1 && env.schema < 1e6 ? env.schema : null;
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
  const schema = schemaOf(env);
  if (schema === null) return { status: 'corrupt' };
  // Conteneur ou schéma plus récents que cette version de l'app : lisible,
  // mais à ne JAMAIS réécrire (on perdrait ce qu'on ne comprend pas).
  const newer = (Number.isInteger(env.version) && env.version > VERSION) || schema > currentSchema;
  const meta = { schema, newer };
  if (env.encryption === 'none') return { status: 'ok', raw: env.payload, encryption: 'none', ...meta };
  if (env.encryption === 'safeStorage') {
    let res;
    try {
      await app.whenReady();
      res = await safeStorage.decryptStringAsync(Buffer.from(env.payload, 'base64'));
    } catch (_) {
      return { status: 'undecryptable' };
    }
    if (!res || typeof res.result !== 'string') return { status: 'undecryptable' };
    // Clé renouvelée par Chromium : on ne réécrit PAS le fichier pour autant
    // (une version plus ancienne ne connaîtrait peut-être pas la nouvelle
    // clé). Le prochain enregistrement normal utilisera la nouvelle clé.
    if (res.shouldReEncrypt) console.warn('[accounts] clé de chiffrement renouvelée : utilisée au prochain enregistrement');
    return { status: 'ok', raw: res.result, encryption: 'safeStorage', ...meta };
  }
  return { status: 'corrupt' };
}

// Écriture atomique (voir atomic-file.js) : fichier temporaire synchronisé sur
// disque puis renommé. Une coupure en plein milieu laisse l'ancienne version intacte.
const writeAtomic = (filePath, obj) => writeAtomicText(filePath, JSON.stringify(obj));

const asideName = (filePath, label) => `${filePath.replace(/\.json(\.bak)?$/, '')}.${label}-${stamp()}.json`;

async function moveAside(filePath, label) {
  try {
    await renameWithRetry(filePath, asideName(filePath, label));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Met à l'abri une COPIE de la sauvegarde (.bak) dans backups/ avant qu'une
// rotation ne puisse l'écraser. Utilisé quand le fichier principal est
// illisible ou absent : la sauvegarde est alors peut-être la seule copie
// valide des comptes, et l'utilisateur a pu choisir de ne pas la restaurer
// tout de suite (« Continuer sans restaurer »). Sans cela, deux
// enregistrements suffisaient à la détruire (audit phase 2, C1).
async function preserveBackup(reason) {
  try {
    await fsp.access(file(BAK_FILE));
  } catch (_) {
    return null; // pas de sauvegarde : rien à protéger
  }
  await fsp.mkdir(file(BACKUP_DIR), { recursive: true });
  const dest = path.join(file(BACKUP_DIR), `bak-preserved-${reason}-${stamp()}.json`);
  await copyAtomic(file(BAK_FILE), dest);
  console.warn('[accounts] sauvegarde mise à l\'abri :', path.basename(dest));
  return dest;
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
    // Déterministe (même fichier -> même id à chaque lecture) : la validation
    // d'une migration compare les ids avant/après.
    id = `acc_restored_${index}`;
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

// JSON brut -> comptes (lecture tolérante entrée par entrée). null si la
// charge utile est illisible : JSON invalide, OU JSON valide qui n'est pas
// un tableau. (Jusqu'en 1.1.0, ce second cas donnait « 0 compte, tout va
// bien » : la sauvegarde suivante pouvait alors écraser la bonne génération
// dans .bak — audit phase 2, M1. C'est désormais traité comme une corruption,
// avec proposition de restaurer la sauvegarde.)
function parseRaw(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (_) { return null; }
  if (!Array.isArray(data)) return null;
  return sanitizeList(data, false).accounts || [];
}

async function backupInfo() {
  const b = await decodeFile(file(BAK_FILE));
  const list = b.status === 'ok' ? parseRaw(b.raw) : null;
  return { available: !!list, count: list ? list.length : 0 };
}

// --------------------------------------------------------------- API --

// Fait passer une liste (déjà JSON.parse) du schéma `from` au schéma courant.
// Lève une erreur si une étape manque ou échoue. Pure : n'écrit rien.
function runMigrations(list, from) {
  let data = list;
  for (let v = from; v < currentSchema; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new Error(`migration ${v} -> ${v + 1} absente`);
    data = step(data);
    if (!Array.isArray(data)) throw new Error(`migration ${v} -> ${v + 1} : résultat invalide`);
  }
  return data;
}

// Validation APRÈS migration : aucun compte perdu ni renommé. (On ne refait
// pas la validation stricte de l'enregistrement : un compte ancien au profil
// vide, accepté par la 1.0.4, doit rester lisible et non bloquer la mise à
// jour — il sera corrigé par l'utilisateur.)
function checkMigrated(before, after) {
  if (after.length !== before.length) return 'nombre de comptes modifié';
  for (let i = 0; i < before.length; i++) {
    if (before[i].id !== after[i].id || before[i].profile !== after[i].profile) return 'identifiant ou profil modifié';
  }
  return null;
}

// Migration du fichier principal vers le schéma courant. Étapes, sûres à
// toute interruption (l'ancien fichier reste en place jusqu'au renommage
// atomique final ; relancer l'app refait simplement la migration) :
//   1. copie du fichier d'origine (chiffré, intact) dans backups/ ;
//   2. migration en mémoire + validation ;
//   3. écriture atomique au nouveau schéma, puis relecture et comparaison ;
//      si la relecture diffère, l'original est remis en place depuis la copie.
async function migrateMainFile(cur) {
  const from = cur.schema, to = currentSchema;
  const before = parseRaw(cur.raw);
  let backupPath;
  try {
    await fsp.mkdir(file(BACKUP_DIR), { recursive: true });
    backupPath = path.join(file(BACKUP_DIR), `pre-schema-v${from}-v${to}-${stamp()}.json`);
    await copyAtomic(file(MAIN_FILE), backupPath);

    const migrated = sanitizeList(runMigrations(JSON.parse(cur.raw), from), false).accounts || [];
    const problem = checkMigrated(before, migrated);
    if (problem) throw new Error('validation : ' + problem);

    const raw = JSON.stringify(migrated);
    await writeEnvelope(file(MAIN_FILE), raw, to);
    const back = await decodeFile(file(MAIN_FILE));
    if (back.status !== 'ok' || back.raw !== raw || back.schema !== to) {
      await copyAtomic(backupPath, file(MAIN_FILE));
      throw new Error('relecture différente après écriture');
    }
    console.log(`[accounts] données migrées du schéma ${from} au schéma ${to} (sauvegarde : ${path.basename(backupPath)})`);
    return { status: 'ok', accounts: migrated, encrypted: await canEncrypt(), migrated: { from, to, backupFile: path.basename(backupPath) } };
  } catch (err) {
    console.error(`[accounts] migration du schéma ${from} au schéma ${to} impossible :`, err.code || err.message);
    // Données d'origine intactes : affichées, mais l'app ne les réécrit pas.
    return { status: 'migration_failed', accounts: before, from, to, error: err.code || err.message };
  }
}

// Lecture du fichier principal (à appeler DANS serial()).
async function loadInner() {
  const cur = await decodeFile(file(MAIN_FILE));
  if (cur.status === 'missing') {
    // Fichier principal absent MAIS sauvegarde lisible (restauration
    // interrompue, fichier supprimé à la main…) : ce n'est pas un premier
    // lancement, on propose la sauvegarde au lieu d'annoncer une liste vide
    // (audit phase 2, E1).
    const backup = await backupInfo();
    if (backup.available) return { status: 'missing', backup };
    return { status: 'empty', accounts: [] };
  }
  if (cur.status === 'ok') {
    const accounts = parseRaw(cur.raw);
    if (accounts === null) return { status: 'corrupt', backup: await backupInfo() };
    // Écrit par une version plus récente de l'app : affiché en LECTURE SEULE
    // (le réécrire supprimerait les champs que cette version ne connaît pas).
    if (cur.newer) return { status: 'newer', accounts, schema: cur.schema, supported: currentSchema };
    if (cur.schema < currentSchema) return migrateMainFile(cur);
    // Écrit en clair lors d'un lancement précédent (chiffrement indisponible,
    // ou clé pas encore sur le disque) : on rechiffre dès que c'est possible,
    // avec la sauvegarde (.bak) et les copies de backups/, écrites dans les
    // mêmes conditions. Un échec n'empêche pas de travailler (le fichier en
    // clair reste valide) : on le signale.
    const encrypted = await canEncrypt();
    if (cur.encryption === 'none' && encrypted) {
      const plain = [file(MAIN_FILE), file(BAK_FILE), ...(await backupFiles())];
      if (await keyIsOnDisk()) {
        await reencryptPlainFiles(plain)
          .catch(err => console.warn('[accounts] rechiffrement reporté :', err.code || err.message));
      } else {
        reencryptLater(plain);
      }
    }
    return { status: 'ok', accounts, encrypted };
  }
  // corrompu, ou chiffré par un autre compte Windows / clé DPAPI perdue
  return { status: cur.status === 'undecryptable' ? 'undecryptable' : 'corrupt', backup: await backupInfo() };
}

function load() {
  return serial(loadInner);
}

function save(list) {
  const r = sanitizeList(list, true);
  if (r.error) return Promise.resolve({ ok: false, error: r.error });
  const raw = JSON.stringify(r.accounts);
  if (raw.length > MAX_RAW_CHARS) return Promise.resolve({ ok: false, error: 'données trop volumineuses' });
  return serial(async () => {
    const mainPath = file(MAIN_FILE);
    const cur = await decodeFile(mainPath);
    // Défense en profondeur (le renderer bloque déjà ces cas) : jamais
    // d'écrasement d'un fichier d'une version plus récente, ni d'un fichier
    // dont la migration n'a pas abouti (il serait « migré » sans sauvegarde).
    if (cur.status === 'ok' && cur.newer) return { ok: false, error: 'newer_schema' };
    if (cur.status === 'ok' && cur.schema !== currentSchema && parseRaw(cur.raw) !== null) return { ok: false, error: 'migration_pending' };
    if (cur.status === 'ok' && parseRaw(cur.raw) !== null) {
      // Génération précédente valide -> devient la sauvegarde (copie
      // atomique : .bak n'est jamais à moitié écrit).
      await copyAtomic(mainPath, file(BAK_FILE));
    } else {
      // Fichier actuel absent ou illisible : la sauvegarde est peut-être la
      // seule copie valide -> copie mise à l'abri dans backups/ AVANT que les
      // prochaines rotations ne l'écrasent.
      await preserveBackup(cur.status === 'missing' ? 'main-missing' : 'main-unreadable');
      // Fichier illisible : mis de côté (jamais détruit).
      if (cur.status !== 'missing') await moveAside(mainPath, 'unreadable');
    }
    await writeEnvelope(mainPath, raw, currentSchema);
    return { ok: true, encrypted: await canEncrypt() };
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
    // Ordre sûr à toute interruption : l'ancien fichier est d'abord COPIÉ de
    // côté (pas déplacé), puis remplacé atomiquement par la sauvegarde. Il
    // n'existe aucun instant sans fichier principal.
    try {
      await fsp.copyFile(file(MAIN_FILE), asideName(file(MAIN_FILE), 'unreadable'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await copyAtomic(file(BAK_FILE), file(MAIN_FILE));
    // Relecture complète : la sauvegarde peut être d'un schéma plus ancien
    // (migrée ici, avec sa propre sauvegarde préalable) ou plus récent
    // (lecture seule). `result` a la même forme que la réponse de load().
    const result = await loadInner();
    return { ok: true, accounts: result.accounts || accounts, result };
  }).catch(err => {
    console.error('[accounts] restauration impossible :', err.code || err.message);
    return { ok: false, error: err.code || err.message };
  });
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
    // Un .bak orphelin (sans fichier principal) serait écrasé, voire effacé
    // si la vérification échoue : on en garde d'abord une copie.
    await preserveBackup('pre-migration');

    await fsp.mkdir(file(BACKUP_DIR), { recursive: true });
    const preFile = path.join(file(BACKUP_DIR), `pre-migration-${stamp()}.json`);
    const preRaw = JSON.stringify({
      source: 'localStorage (1.0.4)', createdAt: new Date().toISOString(),
      keys: { ai_accounts: current == null ? null : current, ai_accounts_backup: backup == null ? null : backup }
    });
    await writeEnvelope(preFile, preRaw);

    const written = [[preFile, preRaw]];
    // Les listes de la 1.0.4 sont au schéma 1 : si l'app en est à un schéma
    // plus récent, le chargement qui suit les migre (avec sa sauvegarde).
    if (backup != null) { await writeEnvelope(file(BAK_FILE), backup, 1); written.push([file(BAK_FILE), backup]); }
    if (current != null) { await writeEnvelope(file(MAIN_FILE), current, 1); written.push([file(MAIN_FILE), current]); }

    for (const [p, expected] of written) {
      const back = await decodeFile(p);
      if (back.status !== 'ok' || back.raw !== expected) {
        await fsp.rm(file(MAIN_FILE), { force: true });
        await fsp.rm(file(BAK_FILE), { force: true });
        return { ok: false, error: 'verify' };
      }
    }
    return { ok: true, encrypted: await canEncrypt(), backupFile: path.basename(preFile) };
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
  load, save, restoreBackup, migrateLegacy, pendingRevert, confirmRevert, revertRequested, REVERT_FLAG,
  isIdle, whenIdle, prepareKey,
  SCHEMA,
  _test: {
    sanitizeList, parseRaw, runMigrations,
    // Délai entre deux vérifications de la clé sur le disque (tests uniquement).
    setReencryptPollMs(ms) { reencryptPollMs = ms; },
    // Remplace le schéma courant et les migrations (tests uniquement).
    setSchema(schema, steps) { currentSchema = schema; migrations = steps; },
    resetSchema() { currentSchema = SCHEMA; migrations = MIGRATIONS; }
  }
};
