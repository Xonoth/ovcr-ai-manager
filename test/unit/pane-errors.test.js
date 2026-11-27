// Tests unitaires — classification des erreurs des panneaux IA.

const test = require('node:test');
const assert = require('node:assert/strict');
const pe = require('../../renderer/pane-errors');

test('ERR_ABORTED (-3) et sous-cadres : jamais d\'écran d\'erreur', () => {
  assert.equal(pe.isRelevantFailure(-3, true), false);
  assert.equal(pe.isRelevantFailure(-106, false), false);
  assert.equal(pe.isRelevantFailure(0, true), false);
  assert.equal(pe.isRelevantFailure(undefined, true), false);
  assert.equal(pe.isRelevantFailure(-106, true), true);
});

test('codes réseau courants -> catégories', () => {
  const cases = { '-106': 'offline', '-105': 'dns', '-137': 'dns', '-7': 'timeout', '-118': 'timeout',
    '-102': 'unreachable', '-101': 'unreachable', '-21': 'unreachable', '-200': 'certificate', '-202': 'certificate',
    '-299': 'certificate', '-310': 'blocked', '-20': 'blocked', '-999': 'generic' };
  for (const [code, kind] of Object.entries(cases)) assert.equal(pe.classifyLoadError(Number(code), true).kind, kind, code);
});

test('hors ligne au moment de l\'échec : « Pas de connexion Internet »', () => {
  assert.equal(pe.classifyLoadError(-105, false).kind, 'offline');
  assert.equal(pe.classifyLoadError(-999, false).kind, 'offline');
  assert.equal(pe.classifyLoadError(-202, false).kind, 'certificate', 'un problème de certificat reste un problème de certificat');
});

test('aucun message ne parle de quota, de cooldown ou de limite d\'usage', () => {
  const all = [...Object.values(pe.KINDS), pe.classifyCrash('oom'), pe.classifyCrash('killed'), pe.unresponsive()];
  for (const m of all) {
    assert.doesNotMatch(m.title + ' ' + m.detail, /quota|cooldown|limite|épuis/i, m.title);
    assert.ok(m.title && m.detail);
  }
});

test('plantage : motif expliqué (mémoire)', () => {
  assert.match(pe.classifyCrash('oom').detail, /mémoire/);
  assert.equal(pe.classifyCrash('crashed').kind, 'crashed');
});

test('hostOf : jamais le chemin ni la query', () => {
  assert.equal(pe.hostOf('https://claude.ai/chat/123?token=x'), 'claude.ai');
  assert.equal(pe.hostOf('pas une url'), '(inconnu)');
});
