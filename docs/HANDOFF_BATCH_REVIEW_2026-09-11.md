# Handoff : validation par campagne, pas message par message

11/09/2026. Cette direction remplace le parcours « Valider et suivant » décrit dans le précédent handoff SIMPLE_UX. L'utilisateur a explicitement rejeté la validation individuelle systématique.

## Parcours

Une campagne cohérente, sa cible et son angle, trois exemples consultables au choix, puis un seul bouton « Valider ces N messages ». Ouvrir chaque exemple n'est jamais un prérequis. La démo contient huit contacts fictifs : cinq prêts, un insuffisamment documenté et deux bloqués (réponse/opposition). Les prescripteurs et investisseurs du jeu précédent ne sont plus mélangés à cette campagne de financement.

Les exceptions restent hors du lot sans empêcher la validation des autres. Modifier un message, retirer/réintégrer un contact, changer le contexte, recevoir un refus ou ajouter un destinataire invalide l'accord. Pas de nouvelle boucle de validation individuelle. L'accord couvre un lot fini de textes et destinataires préparés, jamais des messages futurs non connus. Les relances ne sont pas incluses dans ce lot.

## Autorisation réelle et automatisation

Dans la future application connectée, l'équipe doit pouvoir valider un lot et autoriser son exécution planifiée, sans approuver chaque message. Les critères et contrôles restent côté serveur, avec arrêt sur réponse/refus/RDV et identité authentifiée du validateur. Une validation par campagne n'autorise ni les nouveaux destinataires ajoutés ensuite ni d'autres canaux non inclus. La palette read-only historique reste read-only. Aucun sender ou endpoint n'est modifié ici.

`batch-core.mjs` ajoute le contrôle d'un lot fini et son empreinte. `canSend:false` est invariant. Ce code navigateur est une simulation, pas une autorisation serveur. Aucune recherche réelle, IA en ligne, dépense fournisseur, synchronisation Adrien/Mahefa ni expédition n'a été ajoutée.

## Rectangle bloqué en bas

La capture montre un panneau externe ERR_BLOCKED_BY_CSP. Sa position et le contexte deploy-preview sont compatibles avec le Drawer Netlify ; l'URL distante et son DOM n'ont pas pu être inspectés dans cette session, donc l'attribution reste une hypothèse documentée, pas une reproduction distante certaine.

Corrections : script précoce utilisant l'option documentée `ntl-drawer-state=hidden` exclusivement sur le preview de ce site ; masquage ciblé du wrapper injecté Netlify et de son iframe, uniquement dans cette page de démonstration ; styles d'application isolés sous #pp-app ; contrôles de centrage/débordement et bouton de lot accessible sur petit écran. La CSP n'est pas affaiblie pour charger l'outil de feedback. Pour partager sans aucune injection du Drawer, utiliser le permalink immuable du déploiement terminé (fourni par Netlify) plutôt que son alias deploy-preview. La configuration du Drawer du projet n'a pas été changée via API.

Documentation primaire : https://docs.netlify.com/deploy/review-deploys/netlify-drawer-for-feedback/troubleshoot-the-netlify-drawer/ et https://docs.netlify.com/deploy/review-deploys/netlify-drawer-for-feedback/overview/ (consultées le 11/09/2026).

## Tests effectivement exécutés

- 99 tests Node réussis : 67 du moteur existant + 32 nouveaux contrôles lot/CSP/preview.
- 29 contrôles Chromium DOM réussis : validation unique sans ouvrir de message, portée de cinq messages et non seulement trois exemples, édition/retrait et invalidation, exceptions, absence de débordement à 1388/390/320 px, bouton non recouvert, wrapper Netlify simulé caché, aucune erreur JavaScript ni requête réseau.
- Commandes : `node --test experiments/prospect-desk/core.test.mjs experiments/prospect-desk/batch.test.mjs` et `python experiments/prospect-desk/batch-ui-smoke.py`.

Les tests navigateur utilisent les sources réelles dans about:blank avec une passerelle SHA-256 de test, car la navigation réseau/localhost est bloquée dans l'environnement. Les tests Node utilisent WebCrypto natif. Pas une recette d'appel, d'envoi, de Safari ou de la page distante. Les assertions de l'ancien script simple-ui-smoke sont remplacées par une redirection explicite vers le nouveau harnais, pas annoncées comme repassées inchangées.

## Publication

Branche `review/prospect-quality-20260911`, PR #13 de `pipeline_public_prouesse`. Aucun changement sur main ni sur ClayAvecClaude/prouesse-prod. La page reste une démo ; ne pas annoncer que l'application réelle est désormais automatisée.
