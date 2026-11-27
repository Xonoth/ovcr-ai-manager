// Tests unitaires — cooldowns (renderer/cooldowns.js) : états, expiration,
// réinitialisation, changement d'heure, horloge qui recule.
//
// Fuseau imposé : Europe/Paris (changements d'heure réels). Node relit TZ à
// chaque affectation de process.env.TZ.
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const CD = require('../../renderer/cooldowns');

const H = 3600 * 1000;
const at = iso => Date.parse(iso);

test('création : « Épuiser » met l\'échéance à +24 h exactes (UTC)', () => {
  const now = at('2026-06-10T12:00:00Z');
  assert.equal(CD.newEnd(now) - now, 24 * H);
  assert.equal(CD.state(CD.newEnd(now), now), 'active');
});

test('états : non suivi, actif, terminé, puis de nouveau non suivi', () => {
  const now = at('2026-06-10T12:00:00Z');
  assert.equal(CD.state(0, now), 'unknown');
  assert.equal(CD.state(undefined, now), 'unknown');
  assert.equal(CD.state('123', now), 'unknown');
  assert.equal(CD.state(NaN, now), 'unknown');
  assert.equal(CD.state(now + 1000, now), 'active');
  assert.equal(CD.state(now, now), 'ended', 'à l\'échéance exacte : terminé');
  assert.equal(CD.state(now - 23 * H, now), 'ended');
  assert.equal(CD.state(now - 25 * H, now), 'unknown', 'terminé depuis plus de 24 h : plus suivi');
});

test('expiration : actif -> terminé au passage de l\'échéance (réactivation automatique)', () => {
  const end = at('2026-06-11T12:00:00Z');
  assert.equal(CD.state(end, end - 1), 'active');
  assert.equal(CD.state(end, end + 1), 'ended');
  assert.equal(CD.isAvailable(end, end - 1), false);
  assert.equal(CD.isAvailable(end, end + 1), true);
});

test('horloge qui recule : échéance à plus de 24 h -> incohérent (signalé, compté épuisé)', () => {
  const marked = at('2026-06-10T12:00:00Z');
  const end = CD.newEnd(marked);
  const clockBack = marked - 3 * H; // l'utilisateur recule l'heure de 3 h
  assert.equal(CD.state(end, clockBack), 'inconsistent');
  assert.equal(CD.isAvailable(end, clockBack), false);
  assert.equal(CD.view(end, clockBack).confirmToChange, true);
  // petite dérive tolérée (synchronisation NTP)
  assert.equal(CD.state(end, marked - 5 * 60 * 1000), 'active');
});

test('horloge qui avance : simplement terminé plus tôt (pas d\'incohérence)', () => {
  const end = CD.newEnd(at('2026-06-10T12:00:00Z'));
  assert.equal(CD.state(end, end + 2 * H), 'ended');
});

test('changement d\'heure (passage à l\'heure d\'hiver, 25 oct. 2026) : 24 vraies heures', () => {
  // Marqué le 24/10 à 14:00 heure de Paris (UTC+2) ; la nuit suivante, 03:00 -> 02:00.
  const marked = at('2026-10-24T12:00:00Z');
  const end = CD.newEnd(marked);
  assert.equal(new Date(marked).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), '14:00');
  assert.equal(CD.formatRemaining(end - marked), '⏳ 24h 00m');
  // 24 vraies heures plus tard il est 13:00 à Paris (UTC+1) : affiché tel quel.
  assert.equal(CD.formatClock(end, marked), 'demain 13:00');
  assert.equal(CD.state(end, at('2026-10-25T11:59:00Z')), 'active');
  assert.equal(CD.state(end, at('2026-10-25T12:00:01Z')), 'ended');
});

test('changement d\'heure (passage à l\'heure d\'été, 29 mars 2026) : 24 vraies heures', () => {
  const marked = at('2026-03-28T13:00:00Z'); // 14:00 à Paris (UTC+1)
  const end = CD.newEnd(marked);
  assert.equal(CD.formatClock(end, marked), 'demain 15:00');
  assert.equal(CD.formatRemaining(end - marked), '⏳ 24h 00m');
});

test('format du décompte : identique à l\'ancien (à la minute, arrondi bas)', () => {
  assert.equal(CD.formatRemaining(5 * H + 7 * 60 * 1000 + 59 * 1000), '⏳ 5h 07m');
  assert.equal(CD.formatRemaining(59 * 1000), '⏳ 0h 00m');
  assert.equal(CD.formatRemaining(-5), '⏳ 0h 00m');
});

test('libellés : jamais de prétention de détection automatique du quota', () => {
  const now = at('2026-06-10T12:00:00Z');
  const v = { unknown: CD.view(0, now), active: CD.view(now + H, now), ended: CD.view(now - H, now), inconsistent: CD.view(now + 48 * H, now) };
  assert.equal(v.unknown.text, 'Épuiser (24h)', 'libellé historique conservé');
  assert.match(v.unknown.title, /ne connaît pas l'état réel/);
  assert.match(v.active.title, /manuellement/);
  assert.match(v.ended.title, /ne vérifie pas le quota réel/);
  assert.match(v.ended.text, /Fini 11:00|Fini 13:00|Fini 14:00/);
  for (const x of Object.values(v)) assert.doesNotMatch(x.title + x.text, /détect/i);
  assert.equal(v.active.confirmToChange, true, 'annuler un cooldown actif demande confirmation');
  assert.equal(v.unknown.confirmToChange, false);
  assert.equal(v.ended.confirmToChange, false);
});

test('formatClock : aujourd\'hui, hier, demain, autre jour', () => {
  const now = at('2026-06-10T10:00:00Z'); // 12:00 à Paris
  assert.equal(CD.formatClock(at('2026-06-10T08:30:00Z'), now), '10:30');
  assert.equal(CD.formatClock(at('2026-06-09T08:30:00Z'), now), 'hier 10:30');
  assert.equal(CD.formatClock(at('2026-06-11T08:30:00Z'), now), 'demain 10:30');
  assert.equal(CD.formatClock(at('2026-06-01T08:30:00Z'), now), '01/06 10:30');
});

test('signature : change seulement quand un état change', () => {
  const end = at('2026-06-11T12:00:00Z');
  const accs = [{ cooldowns: { claude: end, chatgpt: 0 } }];
  assert.equal(CD.signature(accs, end - 60000), CD.signature(accs, end - 1000));
  assert.notEqual(CD.signature(accs, end - 1000), CD.signature(accs, end + 1000));
  assert.notEqual(CD.signature(accs, end + 1000), CD.signature(accs, end + 25 * H));
});
