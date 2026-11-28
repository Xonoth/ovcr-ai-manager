// Tests unitaires — script de construction (scripts/dist.js, audit phase 2, F6).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dist = require('../../scripts/dist');
const pkg = require('../../package.json');

// Même règle que @electron/packager : un chemin est exclu si un motif y correspond.
const excluded = p => dist.IGNORE.some(re => p.match(re));

test('F6 : la version vient de package.json, et seulement de là', () => {
  assert.equal(dist.packagerOptions(pkg).appVersion, pkg.version);
  assert.equal(dist.packagerOptions({ version: '9.8.7' }).appVersion, '9.8.7');
  assert.equal(pkg.scripts.dist, 'node scripts/dist.js', 'le script npm ne porte plus de version');
  assert.ok(!/\d+\.\d+\.\d+/.test(pkg.scripts.dist));
});

test('F6 : version absente ou invalide -> refus', () => {
  for (const bad of [undefined, {}, { version: '' }, { version: '1.6' }, { version: '1.6.0-beta' }, { version: 42 }]) {
    assert.throws(() => dist.packagerOptions(bad), /version/, JSON.stringify(bad));
  }
});

test('options identiques à l\'ancienne ligne de commande', () => {
  const o = dist.packagerOptions(pkg);
  assert.equal(o.name, '[OVCR] AI Manager');
  assert.equal(o.platform, 'win32');
  assert.equal(o.arch, 'x64');
  assert.equal(path.basename(o.out), 'dist');
  assert.equal(o.overwrite, true);
  assert.equal(o.prune, true);
  assert.deepEqual(o.asar, { unpack: '**/monaco-editor/**' });
});

test('exclus du .exe : tests, scripts, documents internes, extras de Monaco', () => {
  for (const p of ['/test', '/test/unit/dist.test.js', '/scripts/dist.js', '/eslint.config.js', '/PHASE-3.md', '/PROJECT_CONTEXT.md',
    '/README.md', '/SECURITY.md', '/TESTS-MANUELS.md', '/THIRD-PARTY-NOTICES.md', '/DISTRIBUTION-LISEZ-MOI.txt', '/.gitignore',
    '/node_modules/monaco-editor/esm/vs/x.js', '/node_modules/monaco-editor/dev/vs/x.js', '/node_modules/monaco-editor/min-maps/vs/x.map',
    '/node_modules/monaco-editor/CHANGELOG.md', '/node_modules/monaco-editor/min/vs/editor/editor.main.nls.de.js']) {
    assert.equal(excluded(p), true, p);
  }
});

test('gardés dans le .exe : code de l\'app, interface, licence, Monaco min', () => {
  for (const p of ['/main.js', '/accounts-store.js', '/index.html', '/renderer/app.js', '/assets', '/LICENSE', '/package.json',
    '/node_modules/monaco-editor/min/vs/loader.js', '/node_modules/monaco-editor/min/vs/editor/editor.main.js',
    '/node_modules/monaco-editor/min/vs/editor/editor.main.nls.js', '/node_modules/monaco-editor/LICENSE', '/renderer/test-mode.js',
    '/renderer/core.js', '/renderer/diagnostics-ui.js', '/renderer/editor.js', '/renderer/panes.js', '/renderer/accounts-ui.js']) {
    assert.equal(excluded(p), false, p);
  }
});
