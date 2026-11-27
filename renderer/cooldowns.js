// ===== Cooldowns : états et libellés (fonctions pures) =====
//
// Chargé en script classique par index.html (window.OVCRCooldowns) et testable
// sous Node (test/unit/cooldowns.test.js).
//
// Un cooldown est TOUJOURS marqué à la main par l'utilisateur (bouton
// « Épuiser (24h) ») : l'app ne détecte pas, et ne prétend pas détecter,
// l'épuisement réel d'un quota. Donnée stockée : l'échéance, en millisecondes
// depuis l'époque Unix (UTC) — insensible aux fuseaux et aux changements
// d'heure été/hiver (« dans 24 h » = 24 vraies heures). 0 = rien de marqué.
// Le moment du marquage s'en déduit : échéance − 24 h (durée fixe).
//
// États :
//   unknown      rien de marqué (ou terminé depuis plus de 24 h) : l'app ne
//                sait pas si le quota est disponible ;
//   active       marqué épuisé, échéance à venir ;
//   ended        échéance passée depuis moins de 24 h (« terminé à 14:05 ») ;
//   inconsistent échéance à plus de 24 h dans le futur : impossible pour un
//                marquage de 24 h -> l'horloge de l'ordinateur a reculé, ou
//                donnée invalide. Signalé, jamais corrigé en silence.

(function (root) {
  'use strict';

  const HOUR = 3600 * 1000;
  const DURATION_MS = 24 * HOUR;
  const ENDED_VISIBLE_MS = 24 * HOUR;        // « terminé » affiché pendant 24 h
  const CLOCK_TOLERANCE_MS = 10 * 60 * 1000; // petite dérive d'horloge tolérée

  const isTs = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

  function state(end, now) {
    if (!isTs(end)) return 'unknown';
    if (end - now > DURATION_MS + CLOCK_TOLERANCE_MS) return 'inconsistent';
    if (end > now) return 'active';
    if (now - end <= ENDED_VISIBLE_MS) return 'ended';
    return 'unknown';
  }

  // Le service est-il compté « hors cooldown » ? (un état incohérent reste
  // compté comme épuisé : c'est ce que l'utilisateur avait marqué)
  const isAvailable = (end, now) => {
    const s = state(end, now);
    return s !== 'active' && s !== 'inconsistent';
  };

  const newEnd = now => now + DURATION_MS;
  const markedAt = end => end - DURATION_MS;

  // Même format qu'avant la phase 2 : « ⏳ 5h 07m » (à la minute, arrondi bas).
  function formatRemaining(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `⏳ ${h}h ${String(m).padStart(2, '0')}m`;
  }

  // Heure locale lisible, avec le jour si ce n'est pas aujourd'hui.
  function formatClock(ts, now) {
    const d = new Date(ts);
    const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((day(d) - day(new Date(now))) / (24 * HOUR));
    if (diffDays === 0) return hm;
    if (diffDays === -1) return `hier ${hm}`;
    if (diffDays === 1) return `demain ${hm}`;
    return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${hm}`;
  }

  // Libellé + infobulle du bouton de cooldown, et besoin de confirmation.
  function view(end, now) {
    const s = state(end, now);
    switch (s) {
      case 'active':
        return {
          state: s,
          text: formatRemaining(end - now),
          title: `Marqué épuisé (manuellement) ${formatClock(markedAt(end), now)} — fin prévue ${formatClock(end, now)}. Cliquer pour annuler le cooldown.`,
          confirmToChange: true
        };
      case 'ended':
        return {
          state: s,
          text: `✓ Fini ${formatClock(end, now)}`,
          title: `Cooldown terminé ${formatClock(end, now)} (marqué ${formatClock(markedAt(end), now)}). L'app ne vérifie pas le quota réel. Cliquer pour marquer de nouveau épuisé (24h).`,
          confirmToChange: false
        };
      case 'inconsistent':
        return {
          state: s,
          text: '⚠ Échéance incohérente',
          title: `Fin enregistrée ${formatClock(end, now)} : plus de 24 h dans le futur. L'horloge de l'ordinateur a probablement changé. Cliquer pour réinitialiser ce cooldown.`,
          confirmToChange: true
        };
      default:
        return {
          state: 'unknown',
          text: 'Épuiser (24h)',
          title: 'Aucun cooldown suivi : l\'app ne connaît pas l\'état réel du quota. Cliquer quand le quota est épuisé (rappel dans 24 h).',
          confirmToChange: false
        };
    }
  }

  // Signature des états (pour ne refaire le rendu que lors d'un changement
  // d'état : activation, fin, expiration de l'affichage « terminé »).
  function signature(accounts, now) {
    let sig = '';
    for (const acc of accounts) {
      const cds = acc && acc.cooldowns ? acc.cooldowns : {};
      for (const sid of Object.keys(cds)) sig += state(cds[sid], now)[0];
      sig += '|';
    }
    return sig;
  }

  const api = { state, isAvailable, newEnd, markedAt, formatRemaining, formatClock, view, signature, DURATION_MS, ENDED_VISIBLE_MS, CLOCK_TOLERANCE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OVCRCooldowns = api;
})(typeof window !== 'undefined' ? window : globalThis);
