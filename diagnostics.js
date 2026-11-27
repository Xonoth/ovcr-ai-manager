// ===== Diagnostics locaux (processus principal) =====
//
// Journal technique pour comprendre un problème signalé par un membre, SANS
// rien envoyer nulle part : tout reste dans <userData>/logs/ (ovcr.log, puis
// ovcr.1.log et ovcr.2.log en rotation, 1 Mo chacun au plus).
//
// Vie privée : chaque message est EXPURGÉ avant d'être gardé — adresses
// e-mail masquées, URL réduites à leur hôte (une URL de connexion peut porter
// un jeton OAuth), nom du compte Windows retiré des chemins. Les modules de
// l'app ne journalisent déjà que des identifiants techniques (id de compte,
// hôte, code d'erreur), jamais un nom ou un e-mail.
//
// Sources : console.warn / console.error / console.log du main (capturés),
// erreurs non interceptées (main et interface), plantages de processus,
// et rapports de l'interface (canal diag:report, validé et limité en débit).

const path = require('path');
const fs = require('fs');
const os = require('os');

const MAX_FILE_BYTES = 1024 * 1024;
const KEEP_FILES = 3;                 // ovcr.log + ovcr.1.log + ovcr.2.log
const RING_SIZE = 300;
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;
const LEVELS = new Set(['info', 'warn', 'error', 'fatal']);

let logsDir = null;
let logFile = null;
const ring = [];
let writeQueue = Promise.resolve();
let writing = 0;
const original = { log: console.log, warn: console.warn, error: console.error };

// ------------------------------------------------------------- Expurgation --

const HOME = os.homedir();
const USER = path.basename(HOME);

function redact(value, max = MAX_MESSAGE) {
  let s = value == null ? '' : String(value);
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<e-mail>');
  s = s.replace(/\b(https?|wss?):\/\/([^\s/"'<>?#]+)[^\s"'<>]*/gi, (_m, proto, host) => `${proto}://${host}/…`);
  s = s.replace(/\bfile:\/\/\/[^\s"'<>]*/gi, 'file:///…');
  if (USER && USER.length > 1) {
    const esc = USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`([\\\\/]Users[\\\\/])${esc}(?=[\\\\/]|$)`, 'gi'), '$1<utilisateur>');
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function format(arg) {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.code ? ' (' + arg.code + ')' : ''}`;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch (_) { return String(arg); }
}

// ----------------------------------------------------------------- Écriture --

function rotateIfNeeded() {
  try {
    if (fs.statSync(logFile).size < MAX_FILE_BYTES) return;
  } catch (_) {
    return; // pas encore de fichier
  }
  for (let i = KEEP_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? logFile : logFile.replace(/\.log$/, `.${i - 1}.log`);
    const to = logFile.replace(/\.log$/, `.${i}.log`);
    try { fs.renameSync(from, to); } catch (_) { /* fichier absent : rien à faire */ }
  }
}

function writeLine(line, sync) {
  if (!logFile) return;
  if (sync) {
    try { rotateIfNeeded(); fs.appendFileSync(logFile, line, 'utf8'); }
    catch (err) { original.error('[diag] journal inaccessible :', err.code || err.message); }
    return;
  }
  writing++;
  writeQueue = writeQueue.then(async () => {
    try {
      rotateIfNeeded();
      await fs.promises.appendFile(logFile, line, 'utf8');
    } catch (err) {
      original.error('[diag] journal inaccessible :', err.code || err.message);
    } finally {
      writing--;
    }
  });
}

// Enregistre un événement. source : 'main' | 'interface'.
function record(level, source, message, stack, sync) {
  const entry = {
    t: new Date().toISOString(),
    level: LEVELS.has(level) ? level : 'info',
    source,
    message: redact(message),
  };
  if (stack) entry.stack = redact(stack, MAX_STACK);
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  writeLine(`${entry.t} ${entry.level.toUpperCase().padEnd(5)} [${source}] ${entry.message}${entry.stack ? '\n    ' + entry.stack.replace(/\n/g, '\n    ') : ''}\n`, sync);
  return entry;
}

// ----------------------------------------------------------------- Rapports --

// Rapport venu de l'interface (canal diag:report) : validé, borné, limité en
// débit (une page en boucle d'erreurs ne doit pas remplir le disque).
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 60;
let rateStart = 0, rateCount = 0, rateDropped = 0;

function reportFromRenderer(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const level = LEVELS.has(payload.level) && payload.level !== 'fatal' ? payload.level : 'error';
  if (typeof payload.message !== 'string' || payload.message.length === 0) return false;
  const now = Date.now();
  if (now - rateStart > RATE_WINDOW_MS) {
    if (rateDropped) record('warn', 'interface', `${rateDropped} rapport(s) ignoré(s) (trop d'erreurs en une minute)`);
    rateStart = now; rateCount = 0; rateDropped = 0;
  }
  if (++rateCount > RATE_MAX) { rateDropped++; return false; }
  const stack = typeof payload.stack === 'string' ? payload.stack : '';
  record(level, 'interface', payload.message.slice(0, MAX_MESSAGE), stack.slice(0, MAX_STACK));
  return true;
}

// --------------------------------------------------------------- Mise en place --

// Capture console.* du main (les modules écrivent déjà « [module] message »).
function captureConsole() {
  console.log = (...args) => { original.log(...args); record('info', 'main', args.map(format).join(' ')); };
  console.warn = (...args) => { original.warn(...args); record('warn', 'main', args.map(format).join(' ')); };
  console.error = (...args) => { original.error(...args); record('error', 'main', args.map(format).join(' ')); };
}

function init(app, version) {
  logsDir = path.join(app.getPath('userData'), 'logs');
  logFile = path.join(logsDir, 'ovcr.log');
  try { fs.mkdirSync(logsDir, { recursive: true }); }
  catch (err) { original.error('[diag] dossier des journaux impossible à créer :', err.code || err.message); logFile = null; }
  captureConsole();
  const v = version || { name: app.getName(), version: app.getVersion() };
  record('info', 'main', `démarrage ${v.name} ${v.version} — Electron ${process.versions.electron}, ${process.platform} ${os.release()} ${process.arch}`);
}

const recent = (n = 50) => ring.slice(-Math.max(1, Math.min(n, RING_SIZE)));
const whenFlushed = () => writeQueue;
const isFlushed = () => writing === 0;

module.exports = {
  init, record, reportFromRenderer, recent, redact, whenFlushed, isFlushed,
  logsDir: () => logsDir,
  _test: { rotateIfNeeded, setFile(f) { logFile = f; logsDir = path.dirname(f); }, ring, original, MAX_FILE_BYTES }
};
