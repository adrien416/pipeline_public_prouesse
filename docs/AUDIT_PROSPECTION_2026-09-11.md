# Prouesse Pipeline : revue de fond du 11 septembre 2026

Base examinée : `main` au commit `24fedad7e42635306701bc82cb25699c997a7f6a`.

## Verdict

Conserver les briques utiles, mais inverser le parcours. Le produit doit montrer une petite sélection de personnes pertinentes, pourquoi les contacter maintenant, et un message complet à relire. Il ne doit pas demander au banquier de piloter recherche, scoring, enrichissement, phrases puis campagne.

Le problème principal n’est pas seulement le modèle choisi : l’accroche reçoit essentiellement poste, entreprise et secteur. Un modèle plus puissant privé de contexte spécifique restera générique. Automatiser la préparation, pas une pression multicanale aveugle. Une bonne conclusion peut être « pas assez d’éléments, ne pas écrire ».

## Périmètre et honnêteté de la revue

Lecture README, arborescence, PR récentes et parcours clés : App, CampaignPage, search, score, enrich, generate-phrases, campaign, contacts, send, cron-send, _sheets, _auth, webhook-brevo, analytics, package.json et configurations Netlify. Plusieurs grands fichiers ont été lus par plages ; les autres fonctions ne sont pas réputées intégralement auditées.

Pas d’accès aux données réelles de campagne, aux Sheets, emails ou conversations. Aucun envoi, enrichissement payant, changement de compte ou déploiement en production. Aucun test d’exploitation. L’analyse décrit des mécanismes visibles dans le code, pas une mesure de leur effet sur la performance historique.

Le clonage réseau n’a pas fonctionné dans l’environnement de revue. Les fichiers ont été lus via le connecteur GitHub. Le build complet, Vitest et les E2E existants n’ont pas été exécutés. Les tests nouveaux concernent uniquement le prototype isolé.

À conserver : mode précision, filtres avancés, coûts et timings, retours de scoring, certains doublons, campagnes initialement en pause, confirmation d’envoi, tests existants, crons qui continuent sans onglet, échappement du corps HTML, secret du webhook, palette de diagnostics en lecture seule. Ne pas réintroduire un agent de page capable de déclencher des actions.

## 30 constats, avec correction attendue

P0 signifie à traiter avant reprise ou extension des envois, ou défaut central de qualité commerciale. Les correctifs décrits ici ne sont PAS déjà intégrés aux handlers existants par cette PR.

### Ciblage et rédaction

**F01 / P0 métier / Personnalisation de surface.** `generate-phrases.ts / generatePhrase` et sa copie dans `send.ts` utilisent titre, entreprise et secteur, sans pièces, dates, historique, objectif de mission ou argument précis. Tutoiement imposé et exemples génériques. Remplacer la phrase par un dossier prospect puis un message complet. Vouvoiement par défaut. Critère : chaque différence d’angle doit être justifiable par le dossier, pas seulement par un nom changé.

**F02 / P0 métier / Mémoire du modèle traitée comme source.** `score.ts` demande d’utiliser la connaissance du modèle si la description manque. Créer un état non documenté au lieu d’inventer une certitude ou une note neutre exploitable. Un site indisponible ne doit pas produire un prospect vérifié.

**F03 / P1 / Entreprise et interlocuteur confondus.** `score.ts` réutilise la note par domaine, y compris pour des critères pouvant porter sur le contact. Séparer entreprise, personne et moment. Le directeur financier et le responsable technique d’une même entreprise doivent pouvoir recevoir des décisions différentes selon la mission.

**F04 / P1 / Volume par défaut.** `search.ts / generateFiltersWithWebSearch` comporte déjà un mode précision mais privilégie par défaut des listes larges. Commencer par une mission et des exclusions fermes ; élargir explicitement après revue. Le web_search servant aux filtres sectoriels n’est pas une recherche documentée de chaque prospect.

**F05 / P1 / Prescripteurs pénalisés.** `search.ts / rerankContacts` pénalise conseil/agence/ESN indépendamment de la mission et favorise universellement les dirigeants. Profils distincts client, prescripteur, investisseur, institution. Un bureau d’études est une cible légitime pour une coopération technique et financière, sans supposer qu’il lève des fonds.

**F06 / P1 / Vérification surévaluée dans les libellés.** Un domaine présent est nommé « Domaine vérifié ». Une vérification IA sautée faute de temps remplit néanmoins verifiedCount avec la taille du lot. Séparer présence, contrôle effectué, échec et contrôle à reprendre.

**F07 / P1 / Preuves perdues au stockage.** Le mapping de `search.ts` conserve surtout identité, secteur et provenance générique FullEnrich. Conserver fait exact, source, entité, dates d’événement/publication/observation, contradictions, visibilité et validation. Une republication récente ne rajeunit pas un événement ancien.

**F08 / P1 / Feedback mélangé.** `score.ts / buildFeedbackContext` reçoit allContacts plutôt que le seul contexte de recherche décrit par le commentaire. Cloisonner par espace, mission et version des critères ; ne pas appliquer les corrections d’une campagne investisseurs à une recherche de dirigeants.

**F09 / P1 / Validation du score insuffisante.** La conversion JSON en nombres ne remplace pas un schéma strict et une plage validée. Les endpoints déduisent parfois le mode de score de score_2 === "0". Centraliser configuration et fonction de qualification ; une réponse invalide échoue explicitement.

### Parcours et données

**F10 / P1 / Parcours technique.** `App.tsx` expose les étapes et des retours obligés à la recherche. Bureau principal : À relire, À documenter, Suivi humain, Écartés. Travaux longs persistants côté serveur, paramètres avancés secondaires.

**F11 / P1 / Dernière édition non sauvegardée.** `CampaignPage.tsx / useDebouncedSave` utilise sendBeacon en POST pour une modification que `campaign.ts` attend en PUT ; le POST demande les champs de création. Définir un contrat de sauvegarde, états enregistré/échec et version de document. Un changement de méthode seul ne garantit pas l’enregistrement à la fermeture.

**F12 / P1 / Génération sans progrès.** `generate-phrases.ts` rend une chaîne vide sur erreur et `doGeneratePhrases` boucle tant que done reste faux. Ajouter erreurs typées, budgets, garde de progression, plafond de tentatives, annulation et reprise ciblée. Aucun appel répétitif silencieux ni facturation inutile.

**F13 / P2 / État frontend mal isolé.** Session localStorage globale et différence de clé de réinitialisation entre scoring et campagne/enrichissement. État par utilisateur/espace/recherche, purge au changement de compte, tests de navigation. localStorage n’est pas une autorisation serveur.

**F14 / P1 / Compteurs et options trompeurs.** Nombre de résultats enregistré avant dédoublonnage ; exclusion filiales associée à une liste vide ; dédoublonnage global sans modèle clair de relation entreprise/recherches. Corriger les compteurs, implémenter ou retirer les options, conserver une identité stable réutilisable dans plusieurs missions.

**F15 / P1 / Reprise d’enrichissement trop large.** Dans la plage examinée de `enrich.ts`, le polling du premier job peut réinitialiser tous les pending de la recherche après 404/410. Les délais utilisent une date générale de modification. Lier les reprises à un job, horodatage dédié et soumissions idempotentes. Examiner aussi cron-enrich avant intégration.

### Exclusions, autorisations et expédition

**F16 / P0 / Exclusion contournée par la reconstitution serveur.** `contacts.ts / GET` masque statut=exclu ; `campaign.ts / POST` reconstitue les contacts sans ce filtre. L’interface ne fournit pas nécessairement l’identifiant d’un contact qu’elle ne voit plus. Le sender regarde principalement queued+email. Règle serveur commune à la préparation, validation et expédition. Test prioritaire : contact exclu, nouvelle campagne, deux senders, zéro envoi simulé.

**F17 / P0 / Contrôles de propriété hétérogènes.** `campaign.ts / POST` et `generate-phrases.ts` sélectionnent par recherche_id sans les mêmes contrôles de propriétaire que les lectures. Les PUT de contacts/campaign fusionnent largement les champs reçus. Autoriser la recherche par l’identité authentifiée, filtrer les enfants, liste blanche de champs. Propriétaire, statuts d’expédition, compteurs et identités ne doivent pas être modifiables par un PUT générique. Constat statique, aucune exploitation effectuée.

**F18 / P0 / Désabonnement confondu avec bounce.** `webhook-brevo.ts` transforme unsubscribed en bounced. Une ouverture ultérieure peut faire progresser un état bounced. Registre d’opposition indépendant, persistant et prioritaire. Séparer hard bounce, soft bounce, spam, opposition et réponse. Une ouverture n’annule jamais un refus.

**F19 / P0 / Purge destructrice des garde-fous.** `campaign.ts / DELETE purge_all` efface statut email et logs, utilisés pour éviter les recontacts. Archiver les campagnes ; historique et opposition indépendants avec politique de conservation. Supprimer une campagne ne rend pas la personne prospectable.

**F20 / P0 / Deux senders différents.** `send.ts` contrôle notamment les emails doublons et peut générer une phrase à l’expédition. `cron-send.ts` contrôle les domaines et peut remplacer une phrase absente par du vide. L’envoi manuel forcé supprime des temporisations. Un seul service partagé, texte figé avant validation, aucune régénération par le sender, aucun bouton qui contourne opposition et autorisation.

**F21 / P0 / Concurrence et résultat fournisseur ambigu.** Lecture queued, appel Brevo, puis écriture locale sans réservation commune. Le cron garde un instantané pendant sa boucle. Risque de double envoi ou succès distant non enregistré. File persistante, réservation atomique, idempotence fournisseur et réconciliation. Un résultat ambigu devient delivery_unknown, pas une invitation au renvoi. Un verrou seul ne résout pas le crash après acceptation fournisseur.

**F22 / P0 / Écrasement possible d’ajouts Sheets.** `_sheets.ts / appendRow` calcule la ligne via la longueur de A puis values.update. Deux appels peuvent choisir la même ligne. Écritures complètes sans version. Transition : ajout adapté et sérialisation. Cible : base transactionnelle, Sheets pour l’export. Un append atomique ne corrige pas à lui seul les doubles envois.

**F23 / P0 / Démo perdue en cas d’échec de lecture.** `cron-send.ts` peut conserver un ensemble vide de comptes démo après erreur Users, avec expéditeur de repli global. Échec fermé : identité et rôle obligatoirement résolus, aucun envoi sur compte de secours. Démo sans secrets ni données de production.

**F24 / P1 / Fenêtre journalière incohérente.** Jour Paris comparé au préfixe d’un timestamp UTC ; limites par campagne, pas plafond global expéditeur visible. Fenêtres UTC exactes correspondant au jour local, budgets expéditeur/personne/entreprise, tests changements d’heure et pression multicanale.

### Robustesse et mesure

**F25 / P1 / Webhook non idempotent dans tous les cas.** Instantané de logs non mis à jour pendant un tableau d’événements ; doubles comptages et pertes de champs possibles lors d’écritures successives de la même ligne. Identifiant d’événement durable, transitions idempotentes, transaction et précédence explicite. Tester doublons et événements désordonnés.

**F26 / P1 / Erreur de stockage acquittée.** Le catch du webhook répond 200. Acquitter après persistance durable ; sans celle-ci, comportement d’erreur conforme au contrat de retry du fournisseur. Ne pas perdre silencieusement les événements.

**F27 / P1 / Réponses email non justifiées par le branchement.** Le code attend event=reply. La documentation Brevo distingue événements email et réponses SMS ; les réponses email ne figurent pas dans sa liste d’événements transactionnels email. Intégrer une boîte entrante ou un inbound parsing distinct, puis rapprocher les conversations. Distinguer réponse humaine, absence, erreur et réponse positive. Source : https://developers.brevo.com/docs/transactional-webhooks (11/09/2026).

**F28 / P1 / Analytics approximatifs.** `analytics.ts` calcule delivered comme sent-bounced, compte certains logs sans Set de personnes, et prend Math.max entre compteurs divergents. Séparer accepté fournisseur, livraison confirmée, réponse humaine, réponse positive, RDV réservé/tenu, opportunité, mandat. Un inconnu n’est pas une livraison. Mesurer coût par dossier accepté et temps de relecture.

**F29 / P1 sécurité / Collecte web à durcir.** `score.ts / fetchMetaDescription` filtre l’hôte initial, suit les redirections et ne borne pas clairement le corps ; timeout levé après les en-têtes. Service isolé, contrôle DNS et de chaque redirection, réseaux réservés bloqués, taille/durée bornées, texte traité comme donnée non fiable. Ne jamais exécuter une instruction issue d’une page.

**F30 / P2 sécurité / Compatibilités d’auth trop permissives.** `_auth.ts` conserve des valeurs de repli administrateur pour claims absents, des lignes sans propriétaire visibles et un login historique par environnement. Pas une preuve de bypass sans token valide. Migration des identités, claims stricts, propriétaire obligatoire, procédure de récupération et tests d’isolation.

## Personnalisation à construire

1. Mission explicite : services, cible, rôle, taille, géographie, exclusions, capacité et références autorisées.
2. Entreprises avant coordonnées : qualifier les comptes, chercher des événements précis, enrichir ensuite les rares personnes retenues. Pas de téléphone acheté sans usage pertinent et autorisé.
3. Preuves datées : entité résolue, fait exact, source, dates distinctes, vérification et droit d’usage externe. Les sorties IA ne sont pas des sources.
4. Historique autorisé : emails, rendez-vous, refus, relations collègues et mandats déjà engagés. Aucun de ces comptes réels n’a été consulté dans cette revue.
5. Hypothèse prudente : un projet annoncé peut motiver une question de financement, pas l’affirmation d’une levée ouverte.
6. Proposition de valeur unique et bibliothèque de références approuvées : rôle exact de Prouesse, statut de l’opération, formulation et chiffres publiables. Jamais de succès, montant ou nom client inventé.
7. Message complet : un fait, un angle, une demande simple, ton naturel, vouvoiement par défaut, signature réelle conservée.
8. Feedback métier : mauvais rôle, trop tôt, hors cible, déjà en relation, trop générique. Règles candidates versionnées par mission, pas apprentissage global aveugle.

Réserver le raisonnement plus fort à l’analyse et à la rédaction des dossiers présélectionnés. Les modèles moins coûteux peuvent servir à l’extraction contrôlée et au tri préliminaire. Comparer les modèles sur un même jeu de dossiers ; aucune auto-note ne prouve la qualité.

Profils distincts : financement, dette/investissement, croissance externe, prescripteur, investisseur. Institution et transmission nécessitent leurs propres règles, pas une variante du filtre startup. Ne pas inférer une cession de l’âge d’un dirigeant, une difficulté d’un silence ou un impact environnemental d’un seul secteur.

## Multicanal et cadre

**LinkedIn : commencer par la préparation manuelle.** Profil, contexte, brouillon et action humaine. Copier ou ouvrir ne signifie pas envoyé. Unipile documente historique et messagerie, mais capacité API ne vaut pas autorisation LinkedIn. Son User Agreement interdit notamment les robots non autorisés pour contacts et messages ; aucune petite cadence ne garantit l’absence de restriction. Sources : https://developer.unipile.com/docs/getting-started ; https://developer.unipile.com/docs/send-messages ; https://www.linkedin.com/legal/user-agreement (11/09/2026).

**WhatsApp : accord réel et traçable.** Numéro enrichi ne signifie pas accord. La politique Business exige numéro communiqué et opt-in, avec respect des arrêts. Pour la Business Platform, modèles approuvés pour initier hors fenêtre, réponses libres encadrées par les 24 h suivant le dernier message utilisateur. Compte synchronisé et Business Platform officielle ne sont pas équivalents. Source : https://business.whatsapp.com/policy (11/09/2026).

**Email B2B français : pertinence professionnelle, information et opposition simple.** La CNIL admet l’intérêt légitime sous ces conditions, pas une liberté générale sans garde-fous. Vérifier provenance, notices, conservation, sous-traitants, sécurité et conditions du prestataire. La politique anti-spam Brevo n’a pas pu être exploitée lors de cette revue : compatibilité à confirmer avant reprise. Changer pour Gmail ne dispense pas de vérification. Source : https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel (10/06/2026, consultée le 11/09/2026).

Ne pas confondre prospection de mandats de conseil et commercialisation d’investissements : analyse distincte requise.

## Architecture et ordre de reprise

Conserver React et l’hébergement. Base transactionnelle pour entreprises, personnes, missions, preuves, interactions, oppositions, brouillons versionnés et validations ; Sheets reste export. Jobs de recherche/enrichissement persistants et repris sans onglet. File d’envoi unique avec réservation, idempotence, limites globales, arrêt général et réconciliation. Les verrous de ligne PostgreSQL et SKIP LOCKED peuvent servir à répartir les travaux ; ils ne prouvent pas qu’un envoi externe a échoué après un timeout. Documentation : https://www.postgresql.org/docs/current/sql-select.html.

Validation serveur authentifiée portant sur destinataire, texte, signature, pièces jointes, preuves et contexte exacts. Tout changement pertinent l’invalide. Réponse, refus ou RDV suspendent les touches suivantes. RDV confirmé seulement après vérification des disponibilités et création effective de l’événement.

**Lot A :** F16-F23, sauvegarde F11, absence de progrès F12, tests sur vrais handlers et mode sans effet externe. Aucune réactivation automatique des anciennes campagnes.

**Lot B :** dossier prospect, profils, preuves et bibliothèque Prouesse. Jeu pilote proposé de 30 sociétés variées ; chaque affirmation spécifique sourcée, aucun fait inventé toléré, aucun refus contourné. Objectif proposé de 8/10 dossiers jugés dignes d’un contact ; ce n’est pas un résultat mesuré.

**Lot C :** intégrer le bureau dans React et le backend autorisé : données réelles, sauvegarde, erreurs, mobile, exclusions, historique. Ne pas importer les flags de fixtures comme validations réelles.

**Lot D :** email puis LinkedIn manuel ; WhatsApp sur contacts autorisés ; réponses et calendrier ; qualification commerciale. Une relance exige une raison et l’absence de blocage, pas seulement un délai.

**Lot E :** pilote à faible volume avec validation message par message. Mesurer réponses qualifiées, RDV tenus et opportunités. Ne pas augmenter volume, canaux et changer de modèle simultanément.

## Ce que cette branche livre effectivement

Prototype dans `web/public/prospect-desk/`, sept cas entièrement fictifs, cinq profils, messages complets, pièces et dates, blocage sur opposition/relation engagée, accord WhatsApp, LinkedIn manuel, édition, validation liée au contenu, exclusion motivée et export local. Aucun endpoint, sender, secret ou campagne existant n’est modifié.

67 tests Node réussis sur le moteur : `node --test experiments/prospect-desk/core.test.mjs` (Node 22 utilisé). 24 contrôles Chromium réussis dans le DOM en mémoire à 1512 et 390 px, sans erreur JavaScript ni requête externe observée. Le navigateur n’autorisait pas la navigation locale ; SHA-256 y a été fourni par un harnais Python sur about:blank. Les tests Node utilisent WebCrypto natif. Ce n’est pas un test Safari, HTTPS déployé ou production.

Limites : les URL ne sont pas consultées, les faits/accords sont fictifs, aucune IA en ligne n’est appelée, les contrôles rédactionnels ne prouvent pas toutes les affirmations ajoutées, le score n’est pas une probabilité de conversion. L’empreinte navigateur détecte des changements ; elle ne donne jamais autorité pour envoyer. Les délais sont des politiques de démonstration à calibrer, pas des règles légales générales.

Une preview de l’application complète n’est pas une preuve d’isolation de ses fonctions existantes. Tester exclusivement la nouvelle page fictive ; ne pas exercer les senders historiques tant que le backend de test n’est pas isolé.
