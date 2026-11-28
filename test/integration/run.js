// Lance chaque scénario d'intégration dans son propre processus Electron.
// Usage : npm run test:electron
//
// Ce sont des tests d'INTÉGRATION locaux (fenêtre réelle, IPC réel, disque
// réel dans un dossier temporaire). Ils ne chargent aucun service IA distant.
//
// Dossiers temporaires : créés ICI, un par scénario (OVCR_TEST_APPDATA), et
// supprimés ici une fois le processus Electron terminé. Le scénario ne peut
// pas le faire lui-même : sous Windows, Chromium garde ses fichiers ouverts
// jusqu'à la fin du processus (d'où des centaines de %TEMP%\ovcr-int-*
// laissés par les versions précédentes de ce lanceur).

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electron = require('electron'); // depuis Node : chemin du binaire
const SCENARIOS = [
  ['smoke.js'],
  ['storage-recovery.js', { OVCR_SCENARIO: 'corrupt' }],
  ['storage-recovery.js', { OVCR_SCENARIO: 'missing' }],
  ['storage-failures.js'],
  ['storage-versions.js', { OVCR_SCENARIO: 'legacy' }],
  ['storage-versions.js', { OVCR_SCENARIO: 'newer' }],
  ['storage-compat.js'],
  ['storage-hard-kill.js'],
  ['diagnostics.js'],
  ['webview-errors.js'],
  ['popups.js'],
  ['browser-identity.js'],
  ['cooldowns.js'],
  ['ui-basics.js'],
  ['ui-editor.js'],
  ['single-instance.js']
];

// Suppression avec quelques essais : un processus fils de Chromium peut
// tarder de quelques millisecondes à lâcher un fichier.
function removeDir(dir) {
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch (_) { spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 300)']); }
  }
  console.log(`  ⚠ dossier temporaire non supprimé : ${dir}`);
  return false;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovcr-int-'));
let failed = 0, total = 0;
try {
  // Local State avec clé (voir make-local-state.js), copié dans chaque scénario.
  const keyDir = path.join(root, 'cle');
  const made = spawnSync(electron, [path.join(__dirname, 'make-local-state.js')], {
    env: { ...process.env, OVCR_TEST_APPDATA: keyDir, ELECTRON_ENABLE_LOGGING: '' }, encoding: 'utf8', timeout: 60000
  });
  const localState = path.join(keyDir, 'ai-manager', 'Local State');
  let hasKey = false;
  try { hasKey = !!JSON.parse(fs.readFileSync(localState, 'utf8')).os_crypt.encrypted_key; } catch (_) { /* vérifié ci-dessous */ }
  if (!hasKey) {
    console.log(`  ✖ préparation : Local State sans clé (code ${made.status})\n${(made.stdout || '') + (made.stderr || '')}`);
    process.exitCode = 1;
  }

  SCENARIOS.forEach(([file, env], i) => {
    if (!hasKey) return;
    const appData = path.join(root, String(i + 1));
    fs.mkdirSync(appData);
    const r = spawnSync(electron, [path.join(__dirname, file)], {
      env: { ...process.env, ...(env || {}), OVCR_TEST_APPDATA: appData, OVCR_LOCAL_STATE: localState, ELECTRON_ENABLE_LOGGING: '' },
      encoding: 'utf8',
      timeout: 90000
    });
    const out = (r.stdout || '') + (r.stderr || '');
    for (const line of out.split(/\r?\n/)) {
      if (/^\s*[✔✖▶]/.test(line) || line.startsWith('\n▶')) console.log(line);
    }
    const m = out.match(/@@RESULT (.*)/);
    const res = m ? JSON.parse(m[1]) : { name: file, total: 1, failed: 1 };
    if (!m) console.log(`  ✖ ${file} : aucun résultat (code ${r.status}, ${r.error ? r.error.message : 'pas d\'erreur'})\n${out.slice(-2000)}`);
    total += res.total;
    failed += res.failed;
    removeDir(appData);
  });
} finally {
  const cleaned = removeDir(root);
  console.log(`\n${total - failed}/${total} vérifications d'intégration réussies${cleaned ? ' (dossiers temporaires supprimés)' : ''}`);
}
process.exit(failed || process.exitCode ? 1 : 0);
