// ===== [OVCR] AI Manager — export / import des comptes (renderer/transfer-ui.js) =====
//
// Phase 3, P7. Boutons « Exporter » / « Importer » de l'en-tête des comptes.
// L'interface ne choisit jamais de chemin : les boîtes « Enregistrer sous » /
// « Ouvrir » sont ouvertes par le processus principal (accounts:export,
// accounts:import-pick), qui lit, valide et fusionne lui-même les comptes
// (accounts-transfer.js). Ici : l'avertissement avant l'export (fichier EN
// CLAIR), le résumé de l'import et le choix unique pour les conflits.
//
// Les noms et e-mails lus dans un fichier importé ne sont JAMAIS interprétés
// en HTML (textContent partout).
//
// Ne fait rien au chargement : app.js appelle OVCR.transferUi.init().

(function () {
  'use strict';

  // Messages des refus renvoyés par le main (codes : accounts-transfer.js,
  // accounts-store.js, main.js).
  const ERRORS = {
    nothing: 'Aucun compte à exporter.',
    unreadable: 'Fichier illisible.',
    write_failed: 'Écriture du fichier impossible (dossier protégé ou disque plein ?).',
    too_large: 'Fichier trop volumineux (5 Mo au plus).',
    not_json: 'Ce fichier n\'est pas un fichier JSON valide.',
    unknown_format: 'Ce fichier n\'est pas un export de comptes [OVCR] AI Manager.',
    newer_format: 'Ce fichier vient d\'une version plus récente de l\'application : mettez-la à jour pour l\'importer.',
    newer_schema: 'Format plus récent que cette version de l\'application : mettez-la à jour.',
    migration_failed: 'Mise à jour du format du fichier impossible.',
    migration_pending: 'La mise à jour du format des comptes n\'a pas abouti : import impossible pour ne rien écraser.',
    invalid: 'Fichier refusé : un compte est invalide',
    duplicates: 'Fichier refusé : deux comptes y partagent le même identifiant ou le même profil (même session).',
    empty: 'Ce fichier ne contient aucun compte.',
    no_pending_import: 'Import expiré : choisissez de nouveau le fichier.'
  };
  const errorText = (r) => {
    const code = r && r.error;
    const base = ERRORS[code] || ('Erreur : ' + (code || 'inconnue'));
    return code === 'invalid' && r.detail ? `${base} (${r.detail}).` : base;
  };

  // ctx.api : pont window.ovcr ; ctx.renderAccounts : réaffiche la liste ;
  // ctx.ensureWritable : refuse (avec explication) en mode protégé ;
  // ctx.migrateOldAccounts : complète les comptes (services, cooldowns).
  function init({ api, renderAccounts, ensureWritable, migrateOldAccounts }) {
    const { showToast } = OVCR;
    const state = OVCR.state;

    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };

    // Fenêtre modale construite à la volée. buttons : [{ label, primary, onClick(close, btn) }].
    function openDialog(id, title, body, buttons) {
      const old = document.getElementById(id);
      if (old) old.remove();
      const overlay = el('div', 'modal-overlay open');
      overlay.id = id;
      const box = el('div', 'modal modal--transfer');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.appendChild(el('div', 'modal__title', title));
      body.forEach(node => box.appendChild(node));
      const actions = el('div', 'modal__actions');
      const close = () => overlay.remove();
      for (const b of buttons) {
        const btn = el('button', b.primary ? 'btn btn--primary' : 'btn', b.label);
        btn.dataset.transfer = b.key;
        btn.addEventListener('click', () => b.onClick(close, btn));
        actions.appendChild(btn);
      }
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      return overlay;
    }

    // ------------------------------------------------------------ Export --

    window.exportAccounts = function () {
      const n = state.accounts.length;
      if (n === 0) return showToast(ERRORS.nothing, 'warning');
      const warn = el('div', 'form-warning',
        `Le fichier contiendra EN CLAIR les noms, e-mails, profils et cooldowns de vos ${n} compte(s). `
        + 'Toute personne qui l\'ouvre pourra les lire : rangez-le en lieu sûr, ne le partagez pas.');
      const info = el('div', 'modal__desc transfer__info',
        'Il ne contient ni mot de passe, ni cookie, ni session de connexion : après un import sur un autre PC, '
        + 'il faudra vous reconnecter à chaque service.');
      openDialog('exportModal', 'Exporter les comptes', [warn, info], [
        { key: 'cancel', label: 'Annuler', onClick: close => close() },
        {
          key: 'confirm', label: 'Choisir l\'emplacement…', primary: true,
          onClick: async (close, btn) => {
            btn.disabled = true;
            const r = await api.accounts.exportToFile().catch(e => ({ ok: false, error: String(e && e.message) }));
            btn.disabled = false;
            if (r && r.canceled) return; // boîte « Enregistrer sous » annulée : on reste sur l'avertissement
            close();
            if (r && r.ok) showToast(`${r.count} compte(s) exporté(s) dans « ${r.fileName} »`);
            else showToast('Export impossible : ' + errorText(r), 'error');
          }
        }
      ]);
    };

    // ------------------------------------------------------------ Import --

    const MODE_LABELS = [
      ['skip', 'Ignorer', 'garder les comptes actuels tels quels'],
      ['replace', 'Remplacer', 'le compte importé prend la place du compte actuel (même session)'],
      ['copy', 'Importer comme nouveaux comptes', 'nouveau profil, donc session vide : il faudra vous reconnecter']
    ];

    function summaryView(pick) {
      const s = pick.summary;
      const nodes = [];
      const parts = [`${s.fresh} nouveau(x)`];
      if (s.identical) parts.push(`${s.identical} déjà présent(s)`);
      if (s.conflicts.length) parts.push(`${s.conflicts.length} en conflit`);
      nodes.push(el('div', 'modal__desc transfer__info', `Fichier « ${pick.fileName} » : ${s.total} compte(s) — ${parts.join(', ')}.`));

      if (s.conflicts.length) {
        nodes.push(el('div', 'transfer__label', 'Comptes en conflit (même identifiant ou même profil, donc même session) :'));
        const list = el('ul', 'transfer__conflicts');
        for (const c of s.conflicts) {
          const li = el('li');
          li.appendChild(el('strong', null, c.name || '(sans nom)'));
          li.appendChild(document.createTextNode(` (${c.profile}) ↔ compte actuel `));
          li.appendChild(el('strong', null, c.existing.map(e => `${e.name || '(sans nom)'} (${e.profile})`).join(' et ')));
          list.appendChild(li);
        }
        nodes.push(list);
        nodes.push(el('div', 'transfer__label', 'Pour tous ces conflits :'));
        const group = el('div', 'transfer__modes');
        group.setAttribute('role', 'radiogroup');
        for (const [value, label, hint] of MODE_LABELS) {
          const row = el('label', 'transfer__mode');
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'importMode';
          input.value = value;
          if (value === 'skip') input.checked = true;
          row.appendChild(input);
          const text = el('span');
          text.appendChild(el('span', null, label));
          text.appendChild(el('small', null, hint));
          row.appendChild(text);
          group.appendChild(row);
        }
        nodes.push(group);
      }
      nodes.push(el('div', 'transfer__note', 'Une copie de la liste actuelle est enregistrée avant l\'import (dossier « backups » des données de l\'application).'));
      return nodes;
    }

    window.importAccounts = async function () {
      if (!ensureWritable()) return;
      const pick = await api.accounts.importPick().catch(e => ({ ok: false, error: String(e && e.message) }));
      if (pick && pick.canceled) return;
      if (!pick || !pick.ok) return showToast('Import impossible : ' + errorText(pick), 'error');

      const s = pick.summary;
      if (s.fresh === 0 && s.conflicts.length === 0) {
        api.accounts.importCancel().catch(() => { /* rien à oublier de plus */ });
        openDialog('importModal', 'Importer des comptes',
          [el('div', 'modal__desc transfer__info', `Les ${s.total} compte(s) du fichier « ${pick.fileName} » sont déjà présents, à l'identique : rien à importer.`)],
          [{ key: 'close', label: 'Fermer', primary: true, onClick: close => close() }]);
        return;
      }

      openDialog('importModal', 'Importer des comptes', summaryView(pick), [
        {
          key: 'cancel', label: 'Annuler',
          onClick: close => { api.accounts.importCancel().catch(() => { /* jeton oublié au prochain choix */ }); close(); }
        },
        {
          key: 'confirm', label: 'Importer', primary: true,
          onClick: async (close, btn) => {
            if (!ensureWritable()) return;
            const checked = document.querySelector('#importModal input[name="importMode"]:checked');
            const mode = checked ? checked.value : 'skip';
            btn.disabled = true;
            const r = await api.accounts.importApply(pick.token, mode).catch(e => ({ ok: false, error: String(e && e.message) }));
            close();
            if (!r || !r.ok) return showToast('Import impossible : ' + errorText(r), 'error');
            // La liste enregistrée (fusionnée et validée par le main) devient la copie de travail.
            state.accounts = r.accounts;
            migrateOldAccounts();
            renderAccounts();
            const done = [];
            if (r.added) done.push(`${r.added} ajouté(s)`);
            if (r.replaced) done.push(`${r.replaced} remplacé(s)`);
            if (r.copied) done.push(`${r.copied} importé(s) comme nouveaux`);
            if (r.skipped) done.push(`${r.skipped} ignoré(s)`);
            showToast('Import terminé : ' + (done.join(', ') || 'aucun changement'));
          }
        }
      ]);
    };
  }

  OVCR.transferUi = { init };
})();
