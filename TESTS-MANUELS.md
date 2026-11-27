# Tests manuels — [OVCR] AI Manager

Ce qui **ne peut pas** être vérifié par `npm test` / `npm run test:electron` :
les tests automatisés n'utilisent ni le réseau, ni les vrais services IA, ni le
vrai profil. Cette liste est à dérouler **à la main** avant une diffusion.

> Avant de commencer : fermer l'app, puis **copier** le dossier
> `%APPDATA%\ai-manager` ailleurs (sauvegarde de sécurité de vos comptes et
> sessions). Cocher chaque case ; noter tout écart avec le diagnostic
> (`?` → « Diagnostic » → « Copier le diagnostic »).

## 1. Mise à jour depuis la 1.1.0 (vrai profil)

- [ ] Lancer la nouvelle version sur le profil existant : tous les comptes sont là, mêmes noms, mêmes profils, mêmes cooldowns.
- [ ] Ouvrir un service déjà connecté : la session est conservée (pas de reconnexion).
- [ ] `?` → « Diagnostic » : « Stockage : ok, N compte(s), chiffré », « Écriture des comptes : possible ».
- [ ] Modifier un compte, fermer, rouvrir : la modification est conservée.
- [ ] Aucun bandeau rouge au démarrage.

## 2. Connexions aux 9 services (vraies sessions)

Pour chaque service — Claude, ChatGPT, Gemini, Z.ai, Perplexity, Grok, Leonardo AI, Suno, Meshy AI :

- [ ] Le service s'ouvre et s'affiche (le spinner disparaît).
- [ ] Une connexion neuve fonctionne (compte de test), y compris « Continuer avec Google » (popup OAuth) là où elle existe.
- [ ] La session survit à un redémarrage de l'app.

Points d'attention : Leonardo, Suno (auth Clerk : Google / Discord / téléphone) et Meshy n'avaient jamais été testés en connexion réelle avant la phase 2.

## 3. Erreurs réelles des panneaux

- [ ] **Coupure réseau réelle** : débrancher le Wi-Fi/câble, ouvrir un service → écran « Pas de connexion Internet » ; un panneau déjà ouvert affiche le bandeau « Hors ligne » en haut. Rebrancher → « Réessayer » recharge le service, le bandeau disparaît.
- [ ] **Service indisponible / DNS** (ex. pendant une panne d'un fournisseur, ou en bloquant un domaine dans le pare-feu) → écran « Site introuvable » ou « Service injoignable ».
- [ ] **Ouvrir dans le navigateur** : ouvre l'adresse du service dans le navigateur habituel ; le message rappelle que la session du compte n'y est pas.
- [ ] **Fermer le panneau** depuis l'écran d'erreur : panneau vide, mémoire libérée (diagnostic : un processus « Tab » en moins).
- [ ] **Service qui ne répond plus** (difficile à provoquer : page très lourde) → écran « Le service ne répond plus » avec « Attendre ».
- [ ] **Popup de connexion qui échoue** (couper le réseau pendant la popup Google) → boîte « La page de connexion n'a pas pu se charger » avec Réessayer / Ouvrir dans le navigateur / Fermer.
- [ ] Aucun de ces écrans ne parle de quota ou de cooldown, et aucun cooldown n'est modifié.

## 4. Cooldowns

- [ ] « Épuiser (24h) » → décompte ; infobulle « Marqué épuisé (manuellement) … fin prévue … ».
- [ ] Cliquer sur un décompte → « Confirmer ? » ; attendre 5 s → le décompte revient ; deux clics → annulé.
- [ ] Fermer/rouvrir l'app : les décomptes sont conservés.
- [ ] (Optionnel) Reculer l'horloge Windows de 2 jours puis relancer : les cooldowns actifs affichent « ⚠ Échéance incohérente » ; les réinitialiser ; **remettre l'horloge à l'heure**.

## 5. Stockage et récupération (sur une COPIE du profil)

À faire uniquement avec un profil de test ou après avoir sauvegardé `%APPDATA%\ai-manager`.

- [ ] App fermée, renommer `accounts.json` en `accounts.json.test` → au lancement : « Liste de comptes introuvable », sauvegarde proposée ; « Restaurer » remet les comptes.
- [ ] App fermée, remplacer le contenu de `accounts.json` par `{abc` → « Données de comptes illisibles » ; « Continuer sans restaurer », créer un compte : un fichier `backups\bak-preserved-main-unreadable-*.json` apparaît.
- [ ] Lancer l'app deux fois : la 2ᵉ fois, la fenêtre existante revient au premier plan (pas de 2ᵉ fenêtre).
- [ ] Fermer l'app juste après un clic sur « Épuiser » : la modification est bien enregistrée au lancement suivant.

## 6. Diagnostic

- [ ] « Copier le diagnostic » puis coller dans un bloc-notes : aucune adresse e-mail, aucune URL complète.
- [ ] « Ouvrir le dossier des journaux » ouvre `%APPDATA%\ai-manager\logs`.
- [ ] Ouvrir `ovcr.log` : aucune adresse e-mail ni jeton.

## 7. Build distribué (.exe)

- [ ] `npm run dist` puis lancer `[OVCR] AI Manager.exe` depuis un dossier dont le chemin contient `[ ]`, des espaces et des accents : l'app démarre, l'éditeur Monaco s'ouvre, le diagnostic indique la bonne version et « (développement) » n'apparaît **pas**.
- [ ] Le dossier packagé ne contient ni `test/`, ni `eslint.config.js`, ni `TESTS-MANUELS.md`.
