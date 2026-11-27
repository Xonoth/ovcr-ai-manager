// Configuration ESLint (phase 2, lot 6) — outil de DÉVELOPPEMENT uniquement
// (`npm run lint`), jamais embarqué dans le .exe.
//
// Objectif : attraper les vraies erreurs (variable non déclarée, faute de
// frappe dans un nom, code mort, bloc catch vide qui avalerait une erreur),
// pas imposer un style. Aucun reformatage (pas de Prettier).

const js = require('@eslint/js');
const globals = require('globals');

const common = {
  ...js.configs.recommended.rules,
  // Un catch qui ignore volontairement une erreur doit le DIRE (commentaire).
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  // Les seules regex à caractères de contrôle du projet servent justement à
  // REFUSER ces caractères dans un nom de profil (partition de cookies).
  'no-control-regex': 'off',
  'no-var': 'off',               // script classique historique (monacoRequested)
  'prefer-const': 'off'
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**'] },

  // Processus principal, modules Node et outils (CommonJS).
  {
    files: ['*.js', 'scripts/**/*.js', 'test/**/*.js'],
    ignores: ['app-preload.js', 'browser-identity-preload.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: common
  },

  // Preloads : Node (require) + DOM de la page.
  {
    files: ['app-preload.js', 'browser-identity-preload.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: common
  },

  // Interface : scripts CLASSIQUES du navigateur (pas de modules, pas de
  // bundler). Les fonctions window.* appelées par la délégation d'événements
  // sont des globales voulues : listées ici, pour qu'une faute de frappe dans
  // un AUTRE nom reste détectée.
  {
    files: ['renderer/**/*.js', 'assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.browser, monaco: 'readonly', module: 'readonly', globalThis: 'readonly',
        ...Object.fromEntries([
          'hydrateIcons', 'openModal', 'closeModal', 'saveAccount', 'openDeleteModal', 'closeDeleteModal',
          'confirmDelete', 'openService', 'toggleCooldown', 'toggleCardCollapse', 'toggleAllCards',
          'toggleDashboard', 'toggleExplorer', 'toggleIdePanel', 'openHelpModal', 'closeHelpModal',
          'closePane2', 'setLayout', 'selectLocalFolder', 'loadFileInEditor', 'filterPalette',
          'resetSitePermissions', 'showDiagnostic', 'copyDiagnostic', 'openLogsFolder'
        ].map(n => [n, 'writable']))
      }
    },
    rules: common
  },

  // Outils de test tournant DANS la page via executeJavaScript : rien à
  // vérifier de plus ici (le code est sous forme de chaînes).
];
