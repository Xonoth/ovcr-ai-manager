// Preload des <webview> (et de leurs popups) — voir browser-identity.js.
//
// Sur les pages Google, l'app se présente comme Firefox. L'UA est fixé côté
// processus principal ; ici on aligne ce que la PAGE voit en JavaScript sur un
// vrai Firefox, avant que le moindre script de Google ne s'exécute :
//   - pas de navigator.userAgentData (API propre à Chromium) ;
//   - pas de window.chrome ;
//   - navigator.vendor / productSub / appVersion / oscpu / buildID de Firefox.
// Sur tous les autres sites, ce preload ne fait rien.
//
// Les preloads de webview tournent dans un monde isolé : les modifications
// doivent passer par contextBridge.executeInMainWorld pour atteindre la page.

const { contextBridge } = require('electron');

const host = (location.hostname || '').toLowerCase();

if (host === 'google.com' || host.endsWith('.google.com')) {
  contextBridge.executeInMainWorld({
    func: (platform) => {
      const proto = Navigator.prototype;
      const define = (name, value) => {
        try {
          Object.defineProperty(proto, name, { get: () => value, configurable: true, enumerable: true });
        } catch (_) { /* propriété verrouillée : on laisse */ }
      };
      try { delete proto.userAgentData; } catch (_) { /* déjà absent ou verrouillé : sans effet */ }
      try { delete window.chrome; } catch (_) { /* déjà absent ou verrouillé : sans effet */ }
      define('vendor', '');
      define('productSub', '20100101');
      define('appVersion', platform.appVersion);
      define('oscpu', platform.oscpu);
      define('buildID', '20181001000000');
    },
    args: [{
      appVersion: process.platform === 'darwin' ? '5.0 (Macintosh)'
        : process.platform === 'linux' ? '5.0 (X11)' : '5.0 (Windows)',
      oscpu: process.platform === 'darwin' ? 'Intel Mac OS X 10.15'
        : process.platform === 'linux' ? 'Linux x86_64' : 'Windows NT 10.0; Win64; x64'
    }]
  });
}
