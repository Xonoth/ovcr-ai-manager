// Construction du .exe (npm run dist) — audit phase 2, F6.
//
// Jusqu'en 1.5.0, la version était écrite DEUX fois dans package.json :
// "version" et --app-version= dans la ligne de commande du script dist (npm
// passe par cmd.exe sous Windows : $npm_package_version n'y est pas remplacé).
// Ce script lit la version dans package.json, puis enchaîne les trois étapes :
//   1. @electron/packager (API JavaScript, mêmes options que l'ancienne ligne de commande) ;
//   2. scripts/fuses.js (fuses du .exe) ;
//   3. scripts/prune-locales.js (locales Chromium inutilisées).
// Un échec à n'importe quelle étape arrête tout (code 1).
//
// Les motifs IGNORE sont des expressions régulières appliquées aux chemins
// relatifs au projet, en barres obliques (« /test/unit/x.js »). Ils sont
// vérifiés par test/unit/dist.test.js.

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NAME = '[OVCR] AI Manager';

const IGNORE = Object.freeze([
  // Monaco : seul min/ (sans les cartes de sources) est utile.
  'monaco-editor/(dev|esm|min-maps)',
  'monaco-editor/(CHANGELOG|ThirdPartyNotices|README)',
  // Traductions de Monaco : l'interface est en français, Monaco en anglais.
  'editor\\.main\\.nls\\.[a-z-]+\\.js',
  // Documents internes (ni l'utilisateur ni l'app n'en ont besoin dans le .exe).
  '^/(PROJECT_CONTEXT\\.md|README\\.md|SECURITY\\.md|TESTS-MANUELS\\.md|PHASE-3\\.md|THIRD-PARTY-NOTICES\\.md|DISTRIBUTION-LISEZ-MOI\\.txt|\\.gitignore)$',
  '^/test($|/)',
  '^/scripts($|/)',
  '^/eslint\\.config\\.js$'
]);

function packagerOptions(pkg) {
  if (!pkg || typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error('version absente ou invalide dans package.json : ' + (pkg && pkg.version));
  }
  return {
    dir: ROOT,
    name: NAME,
    platform: 'win32',
    arch: 'x64',
    out: path.join(ROOT, 'dist'),
    overwrite: true,
    prune: true,
    junk: true,
    appVersion: pkg.version,
    asar: { unpack: '**/monaco-editor/**' },
    ignore: [...IGNORE]
  };
}

async function main() {
  const pkg = require(path.join(ROOT, 'package.json'));
  const opts = packagerOptions(pkg);
  console.log(`[dist] ${NAME} ${pkg.version} (Electron ${require('electron/package.json').version})`);
  const { packager } = require('@electron/packager');
  const paths = await packager(opts);
  console.log('[dist] packagé : ' + paths.map(p => path.relative(ROOT, p)).join(', '));
  for (const step of ['fuses.js', 'prune-locales.js']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, step)], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`étape ${step} en échec (code ${r.status})`);
  }
  console.log(`[dist] terminé : dist\\${NAME}-win32-x64 (version ${pkg.version})`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[dist] ÉCHEC : ' + err.message);
    process.exit(1);
  });
}

module.exports = { IGNORE, NAME, packagerOptions };
