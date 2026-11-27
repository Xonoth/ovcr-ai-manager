// Lance chaque scénario d'intégration dans son propre processus Electron.
// Usage : npm run test:electron
//
// Ce sont des tests d'INTÉGRATION locaux (fenêtre réelle, IPC réel, disque
// réel dans un dossier temporaire). Ils ne chargent aucun service IA distant.

const { spawnSync } = require('child_process');
const path = require('path');

const electron = require('electron'); // depuis Node : chemin du binaire
const SCENARIOS = [
  ['smoke.js'],
  ['storage-recovery.js', { OVCR_SCENARIO: 'corrupt' }],
  ['storage-recovery.js', { OVCR_SCENARIO: 'missing' }],
  ['storage-failures.js'],
  ['storage-versions.js', { OVCR_SCENARIO: 'legacy' }],
  ['storage-versions.js', { OVCR_SCENARIO: 'newer' }],
  ['diagnostics.js'],
  ['webview-errors.js'],
  ['cooldowns.js'],
  ['single-instance.js']
];

let failed = 0, total = 0;
for (const [file, env] of SCENARIOS) {
  const r = spawnSync(electron, [path.join(__dirname, file)], {
    env: { ...process.env, ...(env || {}), ELECTRON_ENABLE_LOGGING: '' },
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
}
console.log(`\n${total - failed}/${total} vérifications d'intégration réussies`);
process.exit(failed ? 1 : 0);
