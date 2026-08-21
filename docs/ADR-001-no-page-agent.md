# ADR-001 — Pas de PageAgent dans Prouesse Pipeline

Statut : accepté
Date : 2026-08-21

## Décision

Ne pas intégrer `alibaba/page-agent` dans Prouesse Pipeline.

La valeur recherchée est conservée sous une forme plus simple : une palette de commandes (`⌘K`) qui interprète uniquement la phrase saisie par l’utilisateur et appelle des outils métier explicitement autorisés.

Le DOM de l’application n’est jamais envoyé au modèle.

## POC autorisé

Trois outils read-only uniquement :

1. `select_contacts` : retourne un sous-ensemble de contacts déjà présents. Ne modifie ni les contacts ni les filtres persistés.
2. `preview_enrichment` : retourne l’estimation du nombre de contacts, du coût en crédits et du solde. Ne lance jamais l’enrichissement.
3. `diagnose_campaign` : explique les blocages visibles d’une campagne existante. Ne modifie pas la campagne et ne déclenche jamais d’envoi.

## Actions interdites à la palette

La palette n’expose volontairement aucun outil pour :

- envoyer un email ou une campagne ;
- confirmer un envoi ;
- lancer un enrichissement ;
- modifier ou supprimer un contact ;
- créer, modifier ou supprimer une campagne ;
- modifier les clés API ou la configuration ;
- contourner les dialogues de confirmation de l’interface normale.

Il n’existe donc pas de `confirm_send` dans le périmètre de l’assistant. La confirmation d’un envoi reste une action humaine dans l’interface normale.

## Données envoyées au LLM

Pour le POC, seul le texte de la commande saisie dans la palette est envoyé à Claude Haiku afin de choisir l’un des trois outils et d’en extraire des paramètres simples.

Les contacts, emails, campagnes, données Google Sheets et le contenu du DOM ne sont pas envoyés au modèle par cette fonctionnalité.

Si Anthropic est indisponible ou non configuré, un routeur local déterministe prend le relais pour les formulations courantes.

## Critère de poursuite

Le POC ne doit être étendu que si les trois commandes existantes démontrent un gain réel d’usage. Toute future écriture devra faire l’objet d’une nouvelle décision d’architecture et ne pourra jamais inclure la confirmation d’un envoi dans le périmètre du modèle.
