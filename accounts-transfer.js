// ===== Export / import des comptes (phase 3, P7) — fonctions PURES =====
//
// Aucun accès au disque, à Electron ni à l'interface : ce module fabrique le
// fichier exporté, lit un fichier à importer et calcule la fusion avec la
// liste existante. Les boîtes de dialogue, la sauvegarde préalable et
// l'écriture sont faites par accounts-store.js et main.js.
//
// Le fichier exporté est EN CLAIR (décision de l'utilisateur, 28/11/2026) :
// noms, e-mails, profils, couleurs, services et cooldowns. Il ne contient
// JAMAIS de cookies ni de sessions (dossier Partitions/ de Chromium) : un
// compte importé sur un autre PC doit se reconnecter à chaque service.
//
// Formats acceptés à l'import :
//   - l'enveloppe { format: 'ovcr-accounts-export', version, schema, accounts } ;
//   - un tableau de comptes nu (ancienne fondation exportAccountsJSON, jamais
//     proposée dans l'interface, mais simple à relire).
// Validation STRICTE (sanitizeList du stockage) : un seul compte invalide
// (profil vide, id illisible…) fait refuser tout le fichier, avec la raison.
//
// Collisions : un compte importé est en conflit avec un compte existant s'il a
// le même id OU le même profil (même profil = même partition de cookies =
// même session). Un seul choix pour tous les conflits :
//   'skip'    garder les comptes existants (par défaut) ;
//   'replace' le compte importé prend la place du (des) compte(s) existant(s) ;
//   'copy'    importer quand même, avec un nouvel id et un nouveau profil
//             (session vide : il faudra se reconnecter).
// Un compte importé strictement identique à un compte existant n'est jamais
// un conflit : il est simplement compté « déjà présent ».

const EXPORT_FORMAT = 'ovcr-accounts-export';
const EXPORT_VERSION = 1;
const MAX_IMPORT_CHARS = 5 * 1024 * 1024;
const MODES = ['skip', 'replace', 'copy'];

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

// Contenu du fichier exporté (texte JSON indenté, lisible par l'utilisateur).
function buildExport(accounts, { schema, appVersion, now = new Date() }) {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    schema,
    app: appVersion,
    exportedAt: now.toISOString(),
    note: 'Export en clair des comptes [OVCR] AI Manager (sans cookies ni sessions).',
    accounts
  }, null, 2) + '\n';
}

// Texte du fichier -> { ok: true, accounts } ou { ok: false, error, detail? }.
// deps : { schema (courant), sanitizeList(list, strict), runMigrations(list, from) }.
function parseImport(text, { schema, sanitizeList, runMigrations }) {
  if (typeof text !== 'string') return { ok: false, error: 'unreadable' };
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: 'too_large' };
  let data;
  try { data = JSON.parse((text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text)); } catch (_) { return { ok: false, error: 'not_json' }; }

  let list, from = 1;
  if (Array.isArray(data)) {
    list = data;
  } else if (isPlainObject(data) && data.format === EXPORT_FORMAT) {
    if (!Number.isInteger(data.version) || data.version < 1) return { ok: false, error: 'unknown_format' };
    if (data.version > EXPORT_VERSION) return { ok: false, error: 'newer_format' };
    from = data.schema === undefined ? 1 : data.schema;
    if (!Number.isInteger(from) || from < 1) return { ok: false, error: 'unknown_format' };
    if (from > schema) return { ok: false, error: 'newer_schema' };
    if (!Array.isArray(data.accounts)) return { ok: false, error: 'unknown_format' };
    list = data.accounts;
  } else {
    return { ok: false, error: 'unknown_format' };
  }

  if (from < schema) {
    try { list = runMigrations(list, from); } catch (_) { return { ok: false, error: 'migration_failed' }; }
  }
  const r = sanitizeList(list, true);
  if (r.error) return { ok: false, error: 'invalid', detail: r.error };
  if (r.accounts.length === 0) return { ok: false, error: 'empty' };

  // Doublons DANS le fichier : deux comptes au même id ou au même profil
  // partageraient une session ; on refuse plutôt que de deviner.
  const ids = new Set(), profiles = new Set();
  for (const a of r.accounts) {
    if (ids.has(a.id) || profiles.has(a.profile)) return { ok: false, error: 'duplicates' };
    ids.add(a.id);
    profiles.add(a.profile);
  }
  return { ok: true, accounts: r.accounts };
}

// Comparaison champ à champ (ordre des clés indifférent).
function sameAccount(a, b) {
  const norm = x => JSON.stringify(x, Object.keys(x).sort());
  const deep = x => ({ ...x, services: x.services && [...x.services].sort(), cooldowns: x.cooldowns && Object.fromEntries(Object.entries(x.cooldowns).sort()) });
  return norm(deep(a)) === norm(deep(b));
}

// Répartit les comptes importés : nouveaux, déjà présents (identiques),
// conflits (même id ou même profil qu'un ou plusieurs comptes existants).
function planImport(existing, incoming) {
  const fresh = [], identical = [], conflicts = [];
  for (const inc of incoming) {
    const matches = existing.filter(e => e.id === inc.id || e.profile === inc.profile);
    if (matches.length === 0) fresh.push(inc);
    else if (matches.length === 1 && sameAccount(matches[0], inc)) identical.push(inc);
    else conflicts.push({ incoming: inc, existing: matches });
  }
  return { fresh, identical, conflicts };
}

// Résumé envoyé à l'interface (aucun chemin de fichier).
function summarize(plan) {
  return {
    total: plan.fresh.length + plan.identical.length + plan.conflicts.length,
    fresh: plan.fresh.length,
    identical: plan.identical.length,
    conflicts: plan.conflicts.map(c => ({
      name: c.incoming.name,
      email: c.incoming.email,
      profile: c.incoming.profile,
      existing: c.existing.map(e => ({ name: e.name, email: e.email, profile: e.profile }))
    }))
  };
}

// Premier « profil_N » libre (même règle que l'ajout d'un compte), en évitant
// aussi les profils RÉSERVÉS (dossiers de session déjà présents sur le disque,
// laissés par un compte supprimé : on veut une session vraiment vide).
function freeProfile(used, reserved) {
  let n = 1;
  while (used.has('profil_' + n) || reserved.has('profil_' + n)) n++;
  return 'profil_' + n;
}

// Applique le choix. Renvoie { accounts, added, replaced, skipped, copied }.
// opts : { newId() -> id unique, reservedProfiles: Set (minuscules) }.
function applyImport(existing, plan, mode, { newId, reservedProfiles = new Set() }) {
  if (!MODES.includes(mode)) throw new Error('mode invalide');
  // Copie de travail ; copyOf relie chaque compte existant à SA copie (un
  // compte importé peut porter le même id qu'un compte déjà remplacé : on ne
  // désigne donc jamais une cible par son id).
  const copyOf = new Map(existing.map(a => [a, { ...a }]));
  const result = [...copyOf.values()];
  let added = 0, replaced = 0, skipped = plan.identical.length, copied = 0;

  for (const inc of plan.fresh) { result.push({ ...inc }); added++; }

  for (const c of plan.conflicts) {
    if (mode === 'skip') { skipped++; continue; }
    if (mode === 'replace') {
      // Le compte importé prend la place du premier compte en conflit ; les
      // autres (même profil qu'un compte, même id qu'un autre) sont retirés :
      // sinon deux comptes partageraient une session.
      const targets = new Set(c.existing.map(e => copyOf.get(e)));
      const at = result.findIndex(a => targets.has(a));
      for (let i = result.length - 1; i >= 0; i--) if (targets.has(result[i])) result.splice(i, 1);
      // (at = -1 : compte déjà remplacé par un autre conflit -> ajouté en fin.)
      if (at < 0) result.push({ ...c.incoming });
      else result.splice(at, 0, { ...c.incoming });
      replaced++;
      continue;
    }
    // 'copy' : nouvel id, nouveau profil.
    const usedIds = new Set(result.map(a => a.id));
    let id;
    do { id = newId(); } while (usedIds.has(id));
    const usedProfiles = new Set(result.map(a => a.profile));
    const reserved = new Set([...reservedProfiles].map(p => String(p).toLowerCase()));
    const lowerUsed = new Set([...usedProfiles].map(p => p.toLowerCase()));
    const profile = freeProfile(lowerUsed, reserved);
    result.push({ ...c.incoming, id, profile });
    copied++;
  }
  return { accounts: result, added, replaced, skipped, copied };
}

module.exports = {
  EXPORT_FORMAT, EXPORT_VERSION, MAX_IMPORT_CHARS, MODES,
  buildExport, parseImport, planImport, summarize, applyImport, sameAccount
};
