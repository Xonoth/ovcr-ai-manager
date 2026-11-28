// Lancé une fois par run.js, AVANT les scénarios : crée un « Local State »
// contenant une clé de chiffrement (celle de safeStorage, protégée par DPAPI
// pour ce compte Windows). run.js le copie ensuite dans le dossier de chaque
// scénario, qui démarre ainsi comme un profil déjà utilisé : la clé est sur le
// disque et les comptes sont chiffrés tout de suite. Sans lui, chaque scénario
// serait un profil neuf (écriture provisoire en clair, voir accounts-store.js).
// Dossier cible : OVCR_TEST_APPDATA. Une fermeture normale écrit Local State.

const { app, safeStorage } = require('electron');
const path = require('path');

app.setPath('userData', path.join(process.env.OVCR_TEST_APPDATA, 'ai-manager'));
app.whenReady().then(async () => {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('chiffrement indisponible');
    await safeStorage.encryptStringAsync('ovcr');
    app.quit();
  } catch (err) {
    console.error('make-local-state :', err.message);
    app.exit(2);
  }
});
app.on('window-all-closed', () => {});
