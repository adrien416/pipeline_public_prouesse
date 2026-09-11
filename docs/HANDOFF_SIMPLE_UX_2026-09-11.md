# Handoff : simplification maximale de la revue

11/09/2026. Remplace l'interface trois colonnes de la PR #13, sans changer le moteur ni les senders de production. Demande Adrien : utilisation très simple pour lui et Mahefa.

## Ce qui change

Un seul contact à la fois. L'écran montre entreprise, personne, raison de contact en une phrase, objet et message éditables. Deux actions : « Passer » et « Valider et suivant ». La validation avance directement ; « Annuler » revient sur la dernière décision. Passer garde le contact pour plus tard, sans le marquer exclu.

Les scores, choix de mission, filtres, compteurs techniques et troisième colonne disparaissent. « Pourquoi ce contact ? » et « Autres canaux » sont repliés. Email par défaut, LinkedIn manuel, WhatsApp désactivé sans accord utilisable. Les profils existants sont choisis par les cas, pas par l'utilisateur à chaque contact. Les cas bloqués restent hors de la sélection courante, visibles dans Ma sélection pour comprendre pourquoi.

Ma sélection permet de retrouver, relire et copier les brouillons validés. Relire/modifier ou changer de canal demande une nouvelle validation. L'éditeur grandit avec le texte, sans couper la fin du message sur mobile. Aucun champ de recherche fictive ni bouton d'envoi trompeur.

## Tests et limites

67 tests Node existants du moteur repassés sans échec. 25 contrôles Chromium DOM de cette nouvelle interface passés à 1440 et 390 px : navigation, annulation, conservation du texte, validation invalidée, canaux, refus, sélection finale, reprise des contacts passés, absence de débordement horizontal, aucune erreur JavaScript ni requête réseau observée. Le script de reproduction est `experiments/prospect-desk/simple-ui-smoke.py` (Python + Playwright + Chromium). La navigation réseau du navigateur étant interdite dans l'environnement de revue, test sur about:blank avec sources réelles et passerelle SHA-256 de test. Les tests Node utilisent WebCrypto natif. Pas un test Safari ou d'une URL de production.

La page reste une démonstration isolée : données fictives, aucune IA en ligne, aucun envoi, aucun compte connecté, aucune synchronisation Mahefa/Adrien. Décisions en mémoire de l'onglet, réinitialisées au rechargement. Aucun garde-fou serveur existant n'est corrigé par cette simplification. Ne pas la présenter comme une application métier intégrée.

## Intégration future

Conserver cette simplicité. La préparation faite par Mahefa et la validation par Adrien devront s'appuyer sur des identités et droits serveur, une liste partagée persistante et un historique réel. Ne pas simuler cela par un menu de changement de rôle local. Les preuves, exclusions et contrôles restent nécessaires, mais n'ont pas à envahir l'écran principal.

## Retell est dans l'autre dépôt

Le correctif du commentaire CSP fourni dans la même demande est dans `adrien416/ClayAvecClaude`, PR #14, base `prouesse-prod`. Il ne se trouve pas dans ce dépôt public. Handoff dédié : `docs/HANDOFF_RETELL_CSP_2026-09-11.md` dans ClayAvecClaude. Aucune fusion en production effectuée pendant cette demande.
