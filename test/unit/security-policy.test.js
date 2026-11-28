// Tests unitaires — règles de sécurité pures (security-policy.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const policy = require('../../security-policy');

test('isAllowedHost : domaines exacts et sous-domaines de la liste', () => {
  for (const u of ['https://claude.ai/new', 'https://accounts.google.com/x', 'https://clerk.suno.com',
    'https://app.leonardo.ai', 'https://chat.z.ai/', 'https://www.perplexity.ai/']) {
    assert.equal(policy.isAllowedHost(u), true, u);
  }
});

test('isAllowedHost : refuse les imitations et les schémas non web', () => {
  for (const u of ['https://claude.ai.evil.com', 'https://evilclaude.ai', 'https://google.com.attacker.net',
    'about:blank', 'javascript:alert(1)', 'data:text/html,x', 'pas une url', '', null, undefined]) {
    assert.equal(policy.isAllowedHost(u), false, String(u));
  }
});

test('isAllowedWebviewSrc : https obligatoire', () => {
  assert.equal(policy.isAllowedWebviewSrc('https://chatgpt.com/'), true);
  assert.equal(policy.isAllowedWebviewSrc('http://chatgpt.com/'), false);
  assert.equal(policy.isAllowedWebviewSrc('file:///C:/x.html'), false);
  assert.equal(policy.isAllowedWebviewSrc('https://exemple.com/'), false);
});

test('isValidPartition : persist:<profil> non vide, sans caractère de contrôle', () => {
  assert.equal(policy.isValidPartition('persist:profil_1'), true);
  assert.equal(policy.isValidPartition('persist:'), false);
  assert.equal(policy.isValidPartition('profil_1'), false, 'partition en mémoire refusée');
  assert.equal(policy.isValidPartition('persist:a\nb'), false);
  assert.equal(policy.isValidPartition('persist:' + 'x'.repeat(201)), false);
  assert.equal(policy.isValidPartition(undefined), false);
  assert.equal(policy.isValidPartition(''), false);
});

test('hostOf : ne renvoie que l\'hôte (jamais les jetons en query string)', () => {
  assert.equal(policy.hostOf('https://accounts.google.com/o/oauth2?code=SECRET'), 'accounts.google.com');
  assert.equal(policy.hostOf('n\'importe quoi'), '(url illisible)');
});

const indexUrl = 'app://ovcr/index.html';
const oldIndexUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'index.html')).href;

test('isAppIndexUrl : exactement app://ovcr/index.html (hash/query ignorés)', () => {
  assert.equal(policy.isAppIndexUrl(indexUrl), true);
  assert.equal(policy.isAppIndexUrl(indexUrl + '#x?y=1'), true);
  assert.equal(policy.isAppIndexUrl('app://ovcr/autre.html'), false);
  assert.equal(policy.isAppIndexUrl('app://autre/index.html'), false);
  assert.equal(policy.isAppIndexUrl('https://claude.ai/'), false);
  assert.equal(policy.isAppIndexUrl('file:///C:/Windows/index.html'), false);
});

test('isAppIndexUrl : l\'ancienne adresse file:// de l\'interface n\'est plus reconnue (P5)', () => {
  assert.equal(policy.isAppIndexUrl(oldIndexUrl), false);
});

function fakeWindow() {
  const webContents = {};
  return { webContents, isDestroyed: () => false };
}

test('isTrustedSender : seul le cadre principal de la fenêtre hôte, sur l\'interface app://', () => {
  const win = fakeWindow();
  const ok = { sender: win.webContents, senderFrame: { parent: null, url: indexUrl } };
  assert.equal(policy.isTrustedSender(ok, win), true);

  assert.equal(policy.isTrustedSender({ ...ok, sender: {} }, win), false, 'autre webContents (webview, popup, pont file://)');
  assert.equal(policy.isTrustedSender({ ...ok, senderFrame: { parent: {}, url: indexUrl } }, win), false, 'sous-cadre');
  assert.equal(policy.isTrustedSender({ ...ok, senderFrame: { parent: null, url: 'https://claude.ai/' } }, win), false, 'page distante');
  assert.equal(policy.isTrustedSender({ ...ok, senderFrame: { parent: null, url: oldIndexUrl } }, win), false, 'ancienne interface file://');
  assert.equal(policy.isTrustedSender({ ...ok, senderFrame: null }, win), false, 'cadre détruit');
  assert.equal(policy.isTrustedSender(ok, null), false, 'pas de fenêtre');
  assert.equal(policy.isTrustedSender(ok, { ...win, isDestroyed: () => true }), false, 'fenêtre détruite');
});

test('F4 — limite des liens externes : 5 par minute et par page, fenêtre glissante', () => {
  assert.deepEqual(policy.EXTERNAL_OPEN_LIMIT, { max: 5, windowMs: 60000 });
  const allow = policy.createRateLimiter(5, 60000);
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.deepEqual(allow(t0 + i * 1000), { allowed: true, firstRefusal: false }, 'lien ' + (i + 1));
  assert.deepEqual(allow(t0 + 5000), { allowed: false, firstRefusal: true }, '6e lien : refusé, tracé');
  assert.deepEqual(allow(t0 + 6000), { allowed: false, firstRefusal: false }, '7e lien : refusé sans nouvelle trace');
  assert.deepEqual(allow(t0 + 59999), { allowed: false, firstRefusal: false }, 'toujours dans la minute du 1er');
  assert.deepEqual(allow(t0 + 60000), { allowed: true, firstRefusal: false }, 'le 1er sort de la fenêtre : une place libre');
  assert.deepEqual(allow(t0 + 60001), { allowed: false, firstRefusal: true }, 'nouvelle série de refus : tracée');
});

test('F4 — limiteurs indépendants : une page ne consomme pas le quota d\'une autre', () => {
  const a = policy.createRateLimiter(5, 60000);
  const b = policy.createRateLimiter(5, 60000);
  for (let i = 0; i < 6; i++) a(i);
  assert.equal(a(10).allowed, false);
  assert.equal(b(10).allowed, true);
});
