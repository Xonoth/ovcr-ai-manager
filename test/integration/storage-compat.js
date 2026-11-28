// Intégration — compatibilité du chiffrement des comptes avec la 1.2.0.
//
// La 1.2.0 (Electron 43) chiffre et déchiffre avec l'API SYNCHRONE de
// safeStorage ; depuis la 1.3.0, l'app utilise l'API ASYNCHRONE. On vérifie,
// avec le vrai safeStorage du système et un profil temporaire :
//   - un fichier écrit comme le faisait la 1.2.0 est relu par cette version ;
//   - un fichier écrit par cette version est relu comme le ferait la 1.2.0
//     (retour au zip 1.2.0 sans perdre les comptes).
//
// Ce scénario appelle volontairement l'API synchrone, dépréciée en Electron 45
// et supprimée en Electron 46. Quand elle n'existe plus, il le signale et ne
// vérifie que l'aller-retour asynchrone : la compatibilité avec une ancienne
// version se vérifie alors à la main entre deux binaires (voir PROJECT_CONTEXT).

const path = require('path');
const fs = require('fs');
const { safeStorage } = require('electron');
const { scenario, sampleAccount } = require('./harness');

scenario('Compatibilité du chiffrement avec la 1.2.0 (API synchrone)', { allowDeprecated: true }, async ({ js, check, userData }) => {
  const mainFile = path.join(userData, 'accounts.json');
  const hasSync = typeof safeStorage.encryptString === 'function' && typeof safeStorage.decryptString === 'function';
  check(`API synchrone ${hasSync ? 'présente' : 'ABSENTE (Electron ≥ 46) : vérification inter-versions à faire à la main'}`, true);
  check('chiffrement asynchrone disponible', await safeStorage.isAsyncEncryptionAvailable());

  // --- 1.2.0 -> cette version : enveloppe chiffrée par l'API synchrone.
  const legacyList = [sampleAccount(1), sampleAccount(2, { name: 'Accentué é ü 😀' })];
  const legacyRaw = JSON.stringify(legacyList);
  const legacyPayload = hasSync
    ? safeStorage.encryptString(legacyRaw)
    : await safeStorage.encryptStringAsync(legacyRaw);
  fs.writeFileSync(mainFile, JSON.stringify({
    format: 'ovcr-accounts', version: 1, schema: 1, savedAt: new Date().toISOString(),
    encryption: 'safeStorage', payload: legacyPayload.toString('base64')
  }));
  const loaded = await js('ovcr.accounts.load()');
  check('fichier de la 1.2.0 relu : statut ok', loaded.status === 'ok', loaded.status);
  check('fichier de la 1.2.0 relu : mêmes comptes', JSON.stringify(loaded.accounts.map(a => [a.id, a.name])) === JSON.stringify(legacyList.map(a => [a.id, a.name])), loaded.accounts);

  // --- cette version -> 1.2.0 : écrit par l'app (API asynchrone), relu par l'API synchrone.
  const newList = [...legacyList, sampleAccount(3)];
  const saved = await js(`ovcr.accounts.save(${JSON.stringify(newList)})`);
  check('enregistrement chiffré par cette version', saved.ok === true && saved.encrypted === true, saved);
  const env = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
  const buf = Buffer.from(env.payload, 'base64');
  check('format de chiffrement « v10 » (celui de la 1.2.0)', buf.subarray(0, 3).toString('latin1') === 'v10', buf.subarray(0, 3).toString('latin1'));
  let reread = null;
  try {
    reread = hasSync ? safeStorage.decryptString(buf) : (await safeStorage.decryptStringAsync(buf)).result;
  } catch (err) {
    reread = 'ÉCHEC ' + err.message;
  }
  const rereadIds = (() => { try { return JSON.parse(reread).map(a => a.id); } catch (_) { return reread; } })();
  check(hasSync ? 'relu par l\'API synchrone (comme la 1.2.0) : mêmes comptes' : 'relu par l\'API asynchrone : mêmes comptes',
    JSON.stringify(rereadIds) === JSON.stringify(newList.map(a => a.id)), rereadIds);

  // --- La sauvegarde (.bak) reste elle aussi lisible : c'est la génération de la 1.2.0.
  const bak = JSON.parse(fs.readFileSync(path.join(userData, 'accounts.json.bak'), 'utf8'));
  check('génération précédente (.bak) conservée telle quelle', bak.payload === legacyPayload.toString('base64'));
});
