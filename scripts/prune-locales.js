// Purge des locales Chromium inutilisées du build packagé (audit perf).
// L'app est en français ; Chromium n'utilise ces .pak que pour SES propres
// libellés (menus contextuels, etc.). On garde fr + en-US (fallback Chromium)
// + en-GB. Si la locale de l'OS manque, Chromium retombe sur en-US : sans risque.
// Lancé automatiquement par `npm run dist` APRÈS electron-packager.
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['fr.pak', 'en-US.pak', 'en-GB.pak']);
const dir = path.join(__dirname, '..', 'dist', '[OVCR] AI Manager-win32-x64', 'locales');

if (!fs.existsSync(dir)) {
  console.error('[prune-locales] dossier introuvable : ' + dir);
  process.exit(1);
}

let removed = 0, freed = 0;
for (const f of fs.readdirSync(dir)) {
  if (KEEP.has(f)) continue;
  freed += fs.statSync(path.join(dir, f)).size;
  fs.unlinkSync(path.join(dir, f));
  removed++;
}
console.log('[prune-locales] ' + removed + ' locales supprimées, ' + (freed / 1048576).toFixed(1) + ' Mo libérés (gardées : ' + [...KEEP].join(', ') + ')');
