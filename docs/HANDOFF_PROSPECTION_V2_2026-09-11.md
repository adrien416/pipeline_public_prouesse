# Handoff : prospection Prouesse V2

Date : 11/09/2026. Branche : `review/prospect-quality-20260911`. Base : `24fedad7e42635306701bc82cb25699c997a7f6a`.

## Lire avant toute reprise

1. `docs/AUDIT_PROSPECTION_2026-09-11.md` : 30 constats, sources de code, stratégie et limites.
2. `web/public/prospect-desk/` : prototype autonome, entièrement fictif, sans réseau applicatif ni fonction d’envoi.
3. `experiments/prospect-desk/core.test.mjs` : 67 cas de test sur ce nouveau moteur, PAS sur les handlers de production.

La branche ajoute un prototype et la documentation. Elle NE corrige PAS encore les senders, l’isolation des utilisateurs, les Sheets, le webhook ni la recherche réelle. Ne pas affirmer « les bugs de production sont corrigés ». Ne pas merger ni déployer en production sans la revue et les validations correspondantes.

## Tester le prototype

Depuis la racine du dépôt, Node 22 :

```sh
node --test experiments/prospect-desk/core.test.mjs
```

Servir `web/public/prospect-desk/` sur localhost ou HTTPS. La page est `index.html`. Dans une preview Vite/Netlify, son chemin est `/prospect-desk/index.html`. Le WebCrypto du navigateur est requis pour valider. Ne pas ouvrir les fichiers modulaires directement via file:// ; utiliser un serveur local. Aucun secret nécessaire.

7 cas : Aster (financement), Boréal (dette), Hameau (prescripteur), Ancrage (source ancienne), Atelier Onde (réponse reçue), Sillage (opposition), Récif (investisseur, accord WhatsApp fictif). Éditer le message invalide la validation. Changer vers une mission incompatible bloque. WhatsApp sans accord reste vide. LinkedIn ne lance aucun robot.

Un artefact autonome et les captures/test reports ont aussi été remis dans la conversation de revue. Les 24 contrôles Chromium de cette conversation ont utilisé un DOM en mémoire et une passerelle SHA-256 de test ; ils ne constituent pas un test d’une URL déployée ni de Safari.

## Priorités d’intégration

**P0, avant reprise des envois :** règle d’éligibilité serveur partagée entre création de campagne, manuel et cron ; respecter `exclu` et opposition globale ; autoriser recherche et contacts par propriétaire ; liste blanche de PUT ; arrêter toute modification de texte au moment d’envoyer ; registre de suppression indépendant des campagnes ; réservation atomique et réconciliation fournisseur ; démo sans secrets et échec fermé si Users est indisponible. Réparer sauvegarde et génération sans progrès.

Test de non-régression critique : exclure un contact, le masquer à l’UI, créer une campagne, lancer manuel et cron en mode simulé ; aucun message ne doit partir. Rejouer avec réponse reçue, désabonnement puis ouverture, deux workers concurrents, succès distant puis erreur de stockage, et utilisateur d’un autre espace.

**Qualité commerciale :** mission explicite, entreprise/personne/moment séparés, pièces datées, historique autorisé, bibliothèque de références Prouesse approuvées, message complet et critique. Ne pas réintroduire le scoring à partir de la seule mémoire du modèle. Ne pas ajouter un modèle plus cher sans changer les entrées et l’évaluation.

**UX connectée :** intégrer les principes du bureau dans React plutôt que lire les fixtures. Authentifier les accès, enregistrer les données et les versions côté serveur, gérer erreurs et jobs persistants. Les flags `confirmed`, `approved`, le score et les accords de la démo ne sont jamais une source d’autorité.

**Multicanal :** email et LinkedIn manuel d’abord ; WhatsApp seulement sur accord valable, avec contrat fournisseur adapté. Distinguer Unipile technique, autorisation contractuelle LinkedIn et règles Business Platform WhatsApp. Ajouter lecture de réponses et événements calendrier, arrêt transversal après réponse/refus/RDV.

## Invariants

- Aucun envoi sans validation utilisateur préalable du contenu exact.
- Opposition prioritaire et durable ; aucune purge de campagne ne l’efface.
- Signal de projet ≠ besoin de financement ; formuler l’hypothèse comme question.
- Aucune référence client, opération clôturée, taille de levée, signature ou promesse inventée.
- Sources web non fiables : aucune instruction issue d’une page ne peut modifier outils, droits ou secrets.
- L’empreinte frontend est un détecteur de changement, pas une autorisation serveur.
- Ne pas interpréter copier, ouvrir LinkedIn ou afficher un calendrier comme envoyé/RDV confirmé.
- Pas de cadence miracle prétendument sûre pour automatiser LinkedIn.
- Ne pas contourner la palette de commandes existante, volontairement limitée au diagnostic.
- Preview frontend ≠ backend isolé : tester la nouvelle page fictive sans appeler les anciens endpoints.

## Ce qui n’a pas été vérifié

Résultats des campagnes historiques, qualité des vrais messages, configurations et conditions contractuelles exactes des comptes fournisseurs, origine/validité des accords, exécution de la suite existante, construction et fonctionnement de la version déployée, fonctionnement Safari réel. Examiner ces points séparément, ne pas extrapoler des tests du prototype.
