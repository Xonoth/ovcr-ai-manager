// Intégration — instance unique (E2) : un 2e lancement sur le même dossier de
// données se ferme aussitôt et remet la 1re fenêtre au premier plan.

const { spawn } = require('child_process');
const path = require('path');
const { scenario } = require('./harness');

scenario('Instance unique', {}, async ({ check, tmp, app, delay }) => {
  let secondInstanceSeen = false;
  app.on('second-instance', () => { secondInstanceSeen = true; });

  const child = spawn(process.execPath, [path.join(__dirname, 'second-instance-child.js')], {
    env: { ...process.env, OVCR_TEST_APPDATA: tmp, ELECTRON_ENABLE_LOGGING: '' },
    stdio: 'ignore'
  });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { child.kill(); resolve('délai dépassé'); }, 20000);
    child.on('exit', c => { clearTimeout(t); resolve(c); });
  });
  check('le 2e lancement se ferme de lui-même', code === 0, code);
  await delay(300);
  check('la 1re instance est prévenue (fenêtre remise au premier plan)', secondInstanceSeen);
});
