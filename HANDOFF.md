# DOCUMENT DE PASSATION — Prouesse Pipeline
*Mis a jour le : 2026-03-22*

## 1. Snapshot du projet
- **Nom & objectif** : Pipeline de prospection outbound automatise pour Prouesse. L'outil permet de rechercher des dirigeants d'entreprises (via Fullenrich), de les scorer par IA selon des criteres de scalabilite/impact ou cession, d'enrichir leurs emails, puis d'envoyer des campagnes email personnalisees — le tout depuis une interface web.
- **Proprietaire** : Adrien Pannetier — Prouesse (brand lie a Leveo / Lina Capital)
- **Stack** : React 19 + TypeScript + Vite 7 (frontend), Netlify Functions (backend serverless), Google Sheets (BDD), Anthropic Claude API (IA), Fullenrich API (recherche + enrichissement email), Brevo SMTP (envoi emails)
- **Repo** : `adrien416/ClayAvecClaude` — branche active : `claude/outbound-prospecting-pipeline-BkDZA`
- **Deploy** : Netlify (auto-deploy depuis le repo). URL : `https://pipeline-prospection.netlify.app`. Build : `npm run build` dans `/web`, publie `/web/dist`

## 2. Architecture

### Structure des dossiers
```
/
├── web/                          # Application web (tout le code actif)
│   ├── src/                      # Frontend React
│   │   ├── App.tsx               # Routeur principal (tabs: search → scoring → enrich → campaign → analytics)
│   │   ├── main.tsx              # Point d'entree React
│   │   ├── api/client.ts         # Client HTTP — toutes les fonctions d'appel API
│   │   ├── pages/                # 5 pages, une par etape du pipeline
│   │   │   ├── SearchPage.tsx    # Etape 1 : recherche de prospects via description en francais
│   │   │   ├── ScoringPage.tsx   # Etape 2 : scoring IA (scalabilite + impact OU cession)
│   │   │   ├── EnrichPage.tsx    # Etape 3 : enrichissement email via Fullenrich
│   │   │   ├── CampaignPage.tsx  # Etape 4 : creation et envoi de campagne email
│   │   │   └── AnalyticsPage.tsx # Etape 5 : dashboard metriques multi-campagne
│   │   ├── components/           # Composants partages (Layout, ScoreBadge, Spinner, ConfirmDialog, CreditsDisplay)
│   │   ├── contexts/AuthContext.tsx  # Authentification JWT (cookie auth_token)
│   │   └── types/index.ts        # Types TypeScript
│   ├── netlify/functions/        # Backend serverless (Netlify Functions)
│   │   ├── _auth.ts              # Auth : login JWT, verification token, helper json()
│   │   ├── _sheets.ts            # CRUD Google Sheets (readAll, appendRow/appendRows, batchUpdateRows, findRowById, readRawRange, colLetter, getHeadersForWrite avec auto-sync colonnes)
│   │   ├── search.ts             # POST /api/search — Claude Haiku traduit description → filtres Fullenrich → sauvegarde contacts
│   │   ├── score.ts              # POST /api/score — scoring IA par contact (reutilise le score si meme entreprise)
│   │   ├── enrich.ts             # POST /api/enrich — enrichissement email via Fullenrich bulk API
│   │   ├── contacts.ts           # CRUD /api/contacts — lecture, creation, mise a jour, exclusion en masse
│   │   ├── campaign.ts           # CRUD /api/campaign — creation, liste, gestion multi-campagne + protection doublons domaine
│   │   ├── send.ts               # POST /api/send — envoi email via Brevo SMTP + verification plage horaire/jour + anti-doublon
│   │   ├── generate-phrases.ts   # POST /api/generate-phrases — generation de phrases d'accroche IA par batch
│   │   ├── analytics.ts          # GET /api/analytics — metriques campagne (sent, opened, clicked, replied, daily)
│   │   ├── credits.ts            # GET /api/credits — solde credits Fullenrich
│   │   ├── login.ts              # POST /api/login — authentification
│   │   └── webhook-brevo.ts      # POST /api/webhook-brevo — webhook Brevo pour tracking (opens, clicks, bounces)
│   ├── tests/                    # Tests vitest pour les Netlify Functions (108 tests)
│   ├── netlify.toml              # Config Netlify (build command, publish dir)
│   ├── package.json              # Dependances npm
│   └── vite.config.ts            # Config Vite
├── templates/                    # Templates email (premier_contact, relance_1, relance_2)
└── HANDOFF.md                    # Ce fichier
```

### Services externes connectes
| Service | Usage | Fichier |
|---------|-------|---------|
| **Anthropic Claude API** | Traduction description → filtres (Haiku), scoring contacts (Haiku), generation phrase perso (Haiku) | `search.ts`, `score.ts`, `send.ts`, `generate-phrases.ts` |
| **Fullenrich API** | Recherche de personnes v2 (`/api/v2/people/search`), enrichissement email bulk v1 (`/api/v1/contact/enrich/bulk`), credits (`/api/v1/account/credits`) | `search.ts`, `enrich.ts`, `credits.ts` |
| **Google Sheets API** | Base de donnees : onglets Contacts, Recherches, Campagnes, EmailLog, Fonds, Scoring | `_sheets.ts` |
| **Brevo SMTP API** | Envoi d'emails transactionnels reels | `send.ts` |
| **Brevo Webhooks** | Tracking opens, clicks, bounces, unsubscribes → mise a jour EmailLog + Campagnes | `webhook-brevo.ts` |

### Variables d'environnement requises (a configurer dans Netlify)
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Cle API Anthropic (Claude) |
| `FULLENRICH_API_KEY` | Cle API Fullenrich |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON du service account Google encode en base64 |
| `GOOGLE_SHEETS_ID` | ID du Google Spreadsheet |
| `JWT_SECRET` | Secret pour signer les tokens JWT |
| `LOGIN_PASSWORD_HASH` | Hash bcrypt du mot de passe admin |
| `BREVO_API_KEY` | Cle API Brevo (envoi emails) |
| `BREVO_WEBHOOK_SECRET` | Secret pour authentifier les webhooks Brevo |

### Schema Google Sheets
- **Contacts** (25 colonnes) : id, nom, prenom, email, entreprise, titre, domaine, secteur, linkedin, telephone, statut, enrichissement_status, enrichissement_retry, score_1, score_2, score_total, score_raison, score_feedback, recherche_id, campagne_id, email_status, email_sent_at, phrase_perso, date_creation, date_modification
- **Recherches** : id, description, mode, filtres_json, nb_resultats, date
- **Campagnes** (19 colonnes) : id, nom, recherche_id, template_sujet, template_corps, mode, status, max_par_jour, jours_semaine, heure_debut, heure_fin, intervalle_min, total_leads, sent, opened, clicked, replied, bounced, date_creation
- **EmailLog** : id, campagne_id, contact_id, brevo_message_id, status, sent_at, opened_at, clicked_at, replied_at

## 3. Ce qui fonctionne (tout est en production)

### Pipeline complet
1. **Recherche** : Description en francais → Claude traduit en filtres LinkedIn anglais → Fullenrich v2 → sauvegarde contacts en Google Sheets. Auto-retry avec filtres elargis quand 0 resultats.
2. **Scoring IA** : Chaque contact est score par Claude Haiku (scalabilite + impact OU impact_env + signaux_vente). **Reutilisation automatique du score pour les contacts de la meme entreprise** (meme domaine) — evite les appels IA redondants.
3. **Enrichissement email** : Fullenrich bulk API. Tous les contacts qualifies (score >= 7) sont enrichis en une seule requete. Gestion des retries, timeouts, et contacts bloques.
4. **Campagne email** :
   - **Nommage** : Chaque campagne a un nom editable
   - **Multi-campagne** : Plusieurs campagnes par recherche, liste des campagnes existantes visible
   - **Protection doublons** : Les contacts dont le domaine a deja ete contacte dans une autre campagne sont automatiquement exclus (warning affiche)
   - **Phrases IA** : Generees automatiquement a l'ouverture de la page campagne
   - **Envoi reel** : Brevo SMTP envoie les emails pour de vrai (pas de simulation)
   - **Envoi en boucle** : "Envoyer maintenant" envoie TOUS les emails queued avec barre de progression
   - **Verification plage horaire** : send.ts verifie le jour de la semaine et la plage horaire avant chaque envoi
5. **Analytics** : Dashboard multi-campagne avec selecteur dropdown, tableau recapitulatif de toutes les campagnes, metriques (sent, delivery, open, click, reply, bounce), graphe quotidien

### Fonctionnalites transversales
- **Google Sheets persistence** : `getHeadersForWrite` synchronise automatiquement les nouvelles colonnes du code vers la sheet. `colLetter()` supporte >26 colonnes (AA, AB...).
- **Exclusion manuelle** : Bouton "x" par contact, marque `statut=exclu`
- **Navigation** : Tabs progressifs (chaque etape debloque la suivante). localStorage persiste le state entre rechargements.
- **Authentification** : JWT cookie, login unique

## 4. Historique des changements

### Session 3 (2026-03-22)

7. **Webhook Brevo configure** — Webhook enregistre cote Brevo via fonction one-shot (supprimee apres usage). Tracke opens, clicks, hardBounce, softBounce, unsubscribed. URL : `https://pipeline-prospection.netlify.app/api/webhook/brevo?secret=***`.

8. **Audit securite + corrections** (`99dc710`) :
   - **SSRF fix** : `score.ts` bloque les IPs privees/internes dans `fetchMetaDescription` (127.x, 10.x, 192.168.x, localhost, etc.)
   - **XSS fix** : echappement des guillemets `"` et `'` dans les templates HTML email (`send.ts`, `send-test.ts`)
   - **Fuite d'erreurs** : tous les endpoints retournent `"Erreur interne"` au lieu de `String(err)` (details toujours dans `console.error` serveur)
   - **Nettoyage** : suppression du pipeline Python CLI original (`scripts/`, `tests/`, `config.yaml`, `requirements.txt`, `.env.example` racine — 3 569 lignes)

### Session 2

1. **Fix Google Sheets vide** (`1ea0714`) — Les donnees n'etaient pas ecrites car `enrichissement_retry` manquait dans les objets contacts. `getHeadersForWrite` ne synchronisait pas les nouvelles colonnes vers la sheet existante. Ajout de `colLetter()` pour supporter >26 colonnes.

2. **Fix scoring doublons entreprise** (`14eeebd`) — Deux contacts de la meme entreprise (ex: 2 dirigeants de Chance/chance.co) generaient 2 appels IA identiques. Le score est maintenant reutilise et tous les contacts de la meme entreprise sont mis a jour en batch.

3. **Fix campagne "en pause" au lancement** (`14eeebd`) — La campagne etait creee en `status: "draft"`, affichant "en pause" immediatement. Changee en `status: "active"`.

4. **Multi-campagne** (`e93c443`) — GET `/api/campaign` retourne toutes les campagnes (filtrable par `recherche_id`). Campagnes nommables. `recherche_id` stocke dans Campagnes. Protection doublons domaine a la creation et a l'envoi. Analytics multi-campagne avec selecteur + tableau recapitulatif.

5. **Envoi en boucle avec feedback** — "Envoyer maintenant" envoie tous les emails en boucle avec barre de progression (X/Y), au lieu de 1 email par clic. Verification de la plage horaire et du jour de la semaine dans send.ts.

6. **Fix UI mobile** — Barre de statut campagne adaptee pour iPhone (flex-wrap, pas de overflow).

## 5. Decisions non evidentes

- **Haiku pour tout** : Tous les modeles utilisent `claude-haiku-4-5-20251001`. Rapide et pas cher.
- **1 contact par appel API send** : Chaque appel a `/api/send` envoie 1 email (contrainte timeout Netlify 26s). Le frontend boucle cote client.
- **Google Sheets comme BDD** : Choix delibere pour que le client puisse voir/editer les donnees directement.
- **`values.update` au lieu de `values.append`** : Evite les lignes fantomes de Google Sheets.
- **`_rowIndex` dans chaque objet** : Ligne reelle dans la sheet, utilise pour les updates.
- **Score 0 est valide** : `score_total=0` = score mais non qualifie. `score_total=""` = pas encore score.
- **`enrichissement_retry`** : Compteur `retry:N` pour eviter les boucles infinies d'enrichissement.
- **`email_status: "skipped_duplicate"`** : Contacts dont le domaine etait deja contacte dans une autre campagne.
- **Brevo est reel** : `send.ts` envoie de VRAIS emails via Brevo SMTP. Pas de mode dry-run.
- **Fullenrich sans limite cote code** : Le code envoie TOUS les contacts qualifies en un seul batch. Pas de `.slice(0, 10)`. Les limites eventuelles sont cote API Fullenrich (plan/credits).
- **Plage horaire verifiee cote backend** : `send.ts` refuse d'envoyer hors de la plage horaire et les jours non selectionnes.

## 6. Prochaines etapes (par priorite)

1. **Tester l'envoi email de bout en bout** — Lancer une campagne test avec 2-3 contacts, cliquer "Envoyer maintenant", verifier dans Brevo que les emails sont partis et que le webhook remonte les opens/clicks.

2. **Relances automatiques** — Ajouter relance_1 et relance_2 avec delais configurables (J+3, J+7). Les templates existent deja dans `/templates/`.

3. **Export CSV** des contacts qualifies.

4. **Augmenter le rate limit Anthropic** — Le scoring est lent (~25 min pour 100 contacts a 5 req/min).

## 7. Problemes connus

### Bugs identifies
- **Rate limit Anthropic 5 req/min** : Scoring lent. Le code gere ca (skip + retry) mais c'est une limitation.
- **Timezone serveur** : `send.ts` utilise `new Date()` qui est en UTC sur Netlify. La plage horaire est verifiee en UTC, pas en heure de Paris. A corriger si l'utilisateur est en France (ajouter +1h ou +2h selon DST).

### Securite (risques acceptes)
- **Webhook secret en query param** : Le secret Brevo est passe en `?secret=XXX` dans l'URL. Pattern standard Brevo, mais le secret apparait dans les logs serveur. Risque faible (serveur-a-serveur).
- **Pas de rate limiting** : Les endpoints sont proteges par auth JWT, mais un utilisateur connecte pourrait spammer les APIs externes (Fullenrich, Anthropic, Brevo).
- **Pas de CSP header** : Faible risque, pas de contenu genere par les utilisateurs affiche en HTML.

### Dette technique
- **`readAll` a chaque appel** : Lit TOUTE la feuille Contacts. OK pour < 1000 contacts.
- **Email sender configurable** : `send.ts` et `send-test.ts` utilisent `SENDER_EMAIL` / `SENDER_NAME` (env vars) avec fallback `adrien@prouesse.vc`.
- **Login email configurable** : `_auth.ts` utilise `LOGIN_EMAIL` (env var) avec fallback `adrien@prouesse.vc`.

## 8. Comment reprendre ce projet

### Commandes pour demarrer
```bash
cd web
npm install
npx netlify dev     # Lance le dev server local (frontend + functions)
npm test            # Lance les 108 tests vitest
```

### Variables d'env requises pour le dev local
Creer `web/.env` avec :
```
GOOGLE_SERVICE_ACCOUNT_KEY=<base64 du JSON service account>
GOOGLE_SHEETS_ID=<ID du spreadsheet>
FULLENRICH_API_KEY=<cle Fullenrich>
ANTHROPIC_API_KEY=<cle Anthropic>
JWT_SECRET=<secret JWT>
LOGIN_PASSWORD_HASH=<hash bcrypt>
BREVO_API_KEY=<cle Brevo>
BREVO_WEBHOOK_SECRET=<secret webhook Brevo>
```

### Premiere action
Verifier que l'envoi d'emails fonctionne : lancer une campagne avec 2 contacts test, cliquer "Envoyer maintenant", verifier dans Brevo que les emails sont partis.

## 9. Contraintes design & marque

- **Marque** : Prouesse (pas Leveo, pas Lina Capital dans l'interface)
- **Couleurs** : Bleu primaire (`blue-600`), vert pour validation (`green-600`), rouge pour erreurs/exclusion, gris pour disabled
- **Ton** : Professionnel, en francais, tutoiement dans les emails et l'interface
- **Header** : Logo "Prouesse" + "Pipeline" + affichage credits Fullenrich + bouton deconnexion
- **Tabs** : 5 onglets numerotes (1. Recherche, 2. Scoring, 3. Enrichissement, 4. Campagne, 5. Analytics)
- **Ne PAS changer** : L'ordre des onglets, le format des prompts de scoring (valides avec le client)
