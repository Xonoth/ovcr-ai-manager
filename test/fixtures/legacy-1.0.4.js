// Données représentatives (fictives) des versions précédentes, pour les tests
// de migration. Formes relevées dans PROJECT_CONTEXT.md et le code 1.0.x.

// localStorage « ai_accounts » de la 1.0.4 : chaîne JSON brute. Contient les
// cas réels rencontrés au fil des versions : ancien champ `quotas` (avant les
// cooldowns), services manquants (avant Perplexity/Zeta/Leonardo/Suno/Meshy),
// couleur absente, profil vide (accepté par la 1.0.4 sans validation).
const ai_accounts = JSON.stringify([
  {
    id: 'acc_1784230841031', name: 'Compte Démo', email: 'demo@exemple.test', profile: 'profil_1',
    color: '#ffb347',
    services: ['claude', 'chatgpt', 'gemini', 'perplexity', 'zeta', 'grok', 'leonardo', 'suno', 'meshy'],
    cooldowns: { claude: 0, chatgpt: 1784317241031, gemini: 0, perplexity: 0, zeta: 0, grok: 0, leonardo: 0, suno: 0, meshy: 0 }
  },
  {
    id: 'acc_1700000000000', name: 'Ancien compte', email: 'ancien@exemple.test', profile: 'profil_2',
    services: ['claude', 'chatgpt', 'gemini'],
    quotas: { claude: 3 }
  },
  {
    id: 'acc_1700000000001', name: 'Profil vide', email: 'vide@exemple.test', profile: '',
    services: ['claude'], cooldowns: { claude: 0 }
  }
]);

const ai_accounts_backup = JSON.stringify([
  {
    id: 'acc_1784230841031', name: 'Compte Démo', email: 'demo@exemple.test', profile: 'profil_1',
    services: ['claude'], cooldowns: { claude: 0 }
  }
]);

// Fichier accounts.json écrit par la 1.1.0 : enveloppe SANS champ `schema`.
function envelope110(accounts, encryption = 'none') {
  return JSON.stringify({ format: 'ovcr-accounts', version: 1, savedAt: '2026-11-27T22:08:11.505Z', encryption, payload: JSON.stringify(accounts) });
}

const accounts110 = [
  { id: 'acc_a', name: 'Alice', email: 'a@exemple.test', profile: 'profil_1', color: '#8b5cf6', services: ['claude', 'chatgpt'], cooldowns: { claude: 0, chatgpt: 1790000000000 } },
  { id: 'acc_b', name: 'Bob', email: 'B@Exemple.TEST', profile: 'profil_2', services: ['claude'], cooldowns: { claude: 0 } }
];

module.exports = { ai_accounts, ai_accounts_backup, envelope110, accounts110 };
