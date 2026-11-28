// Intégration — arrêt brutal juste après le TOUT PREMIER enregistrement.
//
// Mesuré en 1.6.0 : sur un profil neuf, Chromium n'écrit la clé de
// chiffrement (« Local State ») qu'environ 10 s après l'avoir créée. Jusqu'à
// la 1.5.0, un arrêt brutal dans cet intervalle (plantage, coupure de
// courant, fin de tâche) rendait les comptes indéchiffrables au lancement
// suivant. On rejoue ce cas avec l'app réelle, dans un profil neuf :
//   1. lancement, deux enregistrements, puis processus TUÉ net (TerminateProcess) ;
//   2. relancement : les comptes sont relus, puis rechiffrés une fois la clé
//      écrite sur le disque ;
//   3. troisième lancement : les fichiers chiffrés à l'étape 2 sont relus.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { scenario } = require('./harness');

const CHILD = path.join(__dirname, 'storage-hard-kill-child.js');

scenario('Arrêt brutal juste après le premier enregistrement (profil neuf)', {}, async ({ check, tmp }) => {
  const appData = path.join(tmp, 'profil-neuf');
  fs.mkdirSync(appData);
  // Lance l'enfant ; renvoie ses lignes @@ ; `killOn` : tue net dès cette ligne.
  const run = (mode, killOn) => new Promise(resolve => {
    const env = { ...process.env, OVCR_TEST_APPDATA: appData, OVCR_MODE: mode, ELECTRON_ENABLE_LOGGING: '' };
    delete env.OVCR_LOCAL_STATE;
    const child = spawn(process.execPath, [CHILD], { env });
    const tags = {};
    let buf = '';
    const feed = d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = buf.slice(0, i).match(/@@(\w+) (.*)/);
        buf = buf.slice(i + 1);
        if (!m) continue;
        tags[m[1]] = JSON.parse(m[2]);
        if (m[1] === killOn) child.kill(); // TerminateProcess : aucune fermeture propre
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const t = setTimeout(() => child.kill(), 45000);
    child.on('exit', code => { clearTimeout(t); resolve({ code, ...tags }); });
  });

  const first = await run('save', 'SAVED');
  check('1er lancement : enregistrements réussis', first.SAVED && first.SAVED.ok, first);
  check('1er lancement : clé pas encore sur le disque -> écriture provisoire en clair',
    first.SAVED && first.SAVED.localState === false && first.SAVED.main === 'none' && first.SAVED.bak === 'none', first.SAVED);

  const second = await run('load');
  check('après l\'arrêt brutal : comptes relus (pas « indéchiffrable »)',
    second.LOADED && second.LOADED.status === 'ok' && JSON.stringify(second.LOADED.ids) === '["acc_1","acc_2"]', second.LOADED);
  check('puis fichier principal et .bak rechiffrés une fois la clé sur le disque',
    second.ENCRYPTED && second.ENCRYPTED.main === 'safeStorage' && second.ENCRYPTED.bak === 'safeStorage', second.ENCRYPTED);

  const third = await run('load');
  check('3e lancement : fichiers rechiffrés relus', third.LOADED && third.LOADED.status === 'ok' && third.LOADED.ids.length === 2, third.LOADED);
});
