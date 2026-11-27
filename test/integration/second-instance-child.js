// Lancé par single-instance.js : simule un 2e lancement de l'app sur le
// MÊME dossier de données (OVCR_TEST_APPDATA). Doit se fermer seul (code 0).
const { app } = require('electron');
const path = require('path');

app.setPath('appData', process.env.OVCR_TEST_APPDATA);
require(path.join(__dirname, '..', '..', 'main.js'));
// Filet : si le verrou n'a PAS fermé ce processus, échec explicite.
setTimeout(() => app.exit(3), 10000);
