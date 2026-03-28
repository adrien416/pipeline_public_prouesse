# DOCUMENT DE PASSATION — Prouesse Pipeline
*Mis a jour le : 2026-03-28*

## 0. Pour demarrer immediatement
```bash
git checkout claude/build-prospecting-pipeline-bEApO   # Branche active
cd web
npm install
npm test            # 108 tests doivent passer
npx netlify dev     # Dev server local
```
**Branche de production Netlify** : `claude/build-prospecting-pipeline-bEApO` (configuree dans Netlify → Build & deploy → Production branch)

## 1. Snapshot du projet
- **Nom & objectif** : Pipeline de prospection outbound automatise pour Prouesse. Recherche de dirigeants d'entreprises (Fullenrich + INSEE/SIRENE), scoring IA, enrichissement email, envoi campagnes — tout depuis une interface web.
- **Proprietaire** : Adrien Pannetier — Prouesse (brand lie a Leveo / Lina Capital)
- **Stack** : React 19 + TypeScript + Vite 7 (frontend), Netlify Functions (backend serverless), Google Sheets (BDD), Anthropic Claude API (IA), Fullenrich API (recherche + enrichissement email), API Recherche d'Entreprises gouv.fr (INSEE/SIRENE, gratuit sans cle), Brevo SMTP (envoi emails)
- **Repo** : `adrien416/ClayAvecClaude` — branche active : `claude/build-prospecting-pipeline-bEApO`
- **Deploy** : Netlify (auto-deploy depuis branche feature). URL : `https://pipeline-prospection.netlify.app`. Build : `npm run build` dans `/web`, publie `/web/dist`

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
│   │   ├── search.ts             # POST /api/search — Sonnet 4.6 + web search → filtres Fullenrich/INSEE → verifyBatch → sauvegarde
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
| **Anthropic Claude API** | Filtres recherche (Sonnet 4.6 + web search), verification contacts (Haiku), scoring (Haiku), phrases perso (Haiku) | `search.ts`, `score.ts`, `send.ts`, `generate-phrases.ts` |
| **Fullenrich API** | Recherche de personnes v2 (`/api/v2/people/search`), enrichissement email bulk v1 (`/api/v1/contact/enrich/bulk`), credits (`/api/v1/account/credits`) | `search.ts`, `enrich.ts`, `credits.ts` |
| **API Recherche d'Entreprises** | Base SIRENE/INSEE. Gratuit, sans cle, 7 req/s. Recherche par secteur NAF (A-U), departement, categorie PME/ETI/GE | `search.ts` |
| **Google Sheets API** | Base de donnees : onglets Contacts, Recherches, Campagnes, EmailLog, Users | `_sheets.ts` |
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
| `LOGIN_EMAIL` | Email admin (fallback: adrien@prouesse.vc) |
| `SENDER_EMAIL` | Email expediteur Brevo |
| `SENDER_NAME` | Nom expediteur |

### Schema Google Sheets
- **Contacts** (27 colonnes) : id, nom, prenom, email, entreprise, titre, domaine, secteur, linkedin, telephone, statut, enrichissement_status, enrichissement_retry, score_1, score_2, score_total, score_raison, score_feedback, recherche_id, campagne_id, email_status, email_sent_at, phrase_perso, source, date_creation, date_modification, user_id
- **Recherches** (7 colonnes) : id, description, mode, filtres_json, nb_resultats, date, user_id
- **Campagnes** (21 colonnes) : id, nom, recherche_id, template_sujet, template_corps, mode, status, max_par_jour, jours_semaine, heure_debut, heure_fin, intervalle_min, total_leads, sent, opened, clicked, replied, bounced, date_creation, user_id, user_role
- **EmailLog** : id, campagne_id, contact_id, brevo_message_id, status, sent_at, opened_at, clicked_at, replied_at
- **Users** : id, email, password_hash, nom, role (admin/user/demo), sender_email, sender_name

## 3. Ce qui fonctionne (tout est en production)

### Pipeline de recherche (refonte session 6 — split en 3 etapes)
```
ÉTAPE 1 : POST /api/search-filters (~2-4s)
   callClaudeCombined (Sonnet 4.6, PAS de web search)
   → Genere filtres Fullenrich (LinkedIn) + filtres INSEE (SIRENE)
   → Retourne _reasoning + cout IA + named_competitors (si recherche concurrents)

ÉTAPE 1b (optionnelle) : POST /api/search-competitors (~5-8s)
   Sonnet 4.6 + web search (max 2 recherches)
   → Cherche le site de l'entreprise + "[nom] concurrents France"
   → Retourne la liste des vrais concurrents trouves sur le web
   → Declenche uniquement si "concurrent/similaire/.com/.fr" dans la description

ÉTAPE 2 : POST /api/search (~3-8s)
   Si named_competitors : chemin NOMME (recherche par nom, pas de verify)
   Sinon : chemin INDUSTRIE (Fullenrich + verify + INSEE)
   → Filtre regex titres (exclut Product Owner, CAC, auditeurs, etc.)
   → Chemin industrie : verifyBatch (Haiku) verifie chaque entreprise
   → Enrichissement IA des noms/domaines manquants (contacts INSEE)
   → Deduplication + sauvegarde Google Sheets
   → "Chercher plus" : append mode avec offset (continue la pagination)
```

**Couts** : ~$0.01-0.03 par recherche generique, ~$0.05-0.15 avec recherche concurrents (web search)
**Modeles** : Sonnet 4.6 (filtres + concurrents), Haiku 4.5 (verification + scoring + enrichissement noms)

### Fichiers cles du pipeline de recherche
| Fichier | Role |
|---------|------|
| `_search-ai.ts` | Prompt combine + callClaudeCombined (partage entre endpoints) |
| `search-filters.ts` | POST /api/search-filters — Etape 1 : analyse IA |
| `search-competitors.ts` | POST /api/search-competitors — Etape 1b : web search concurrents |
| `search.ts` | POST /api/search — Etape 2 : Fullenrich + INSEE + verify + save |

### Fonctionnalites recherche
- **Resume search** : bouton "Voir" sur chaque recherche precedente charge les contacts
- **Chercher plus** : bouton sous les resultats, append avec offset au meme recherche_id
- **Statut live** : l'UI affiche l'etape en cours ("Analyse du secteur...", "Recherche web concurrents...", etc.)
- **Cout IA** : affiche en temps reel a cote du raisonnement
- **Cap cout** : $0.50 max par recherche (chemin industrie)
**Modeles** : Sonnet 4.6 (filtres), Haiku 4.5 (verification + scoring)

### Pipeline complet (5 etapes)
1. **Recherche** : voir ci-dessus. Limite = contacts VERIFIES (pas bruts). Web search + verification IA.
2. **Scoring IA** : Chaque contact score par Haiku (scalabilite + impact OU cession). Reutilisation du score par domaine.
3. **Enrichissement email** : Fullenrich bulk API + cascade INSEE (si pas de LinkedIn, cherche via Fullenrich search puis re-enrichit).
4. **Campagne email** : Multi-campagne, protection doublons domaine, phrases IA, envoi Brevo reel, plage horaire.
5. **Analytics** : Dashboard multi-campagne, metriques, graphe quotidien.

### Fonctionnalites transversales
- **Google Sheets persistence** : `getHeadersForWrite` synchronise automatiquement les nouvelles colonnes du code vers la sheet. `colLetter()` supporte >26 colonnes (AA, AB...).
- **Exclusion manuelle** : Bouton "x" par contact, marque `statut=exclu`
- **Navigation** : Tabs progressifs (chaque etape debloque la suivante). localStorage persiste le state entre rechargements.
- **Authentification** : JWT cookie, login unique

## 4. Historique des changements

### Session 7 (2026-03-28) — Robustesse Google Sheets (onglet Jobs)

23. **Fix parse range `Jobs!1:1`** : `readHeaders()` n'utilise plus le range ambigu `tab!1:1` et passe en A1 explicite (`'tab'!A1:ZZ1`).  
24. **Auto-creation des onglets manquants** : ajout de `ensureSheetExists(tabName)` avant la lecture des headers. Si `Jobs` (ou autre) n'existe pas, l'onglet est cree automatiquement au lieu de faire planter la function.  
25. **Noms d'onglets echappes** : les ecritures d'headers utilisent maintenant un nom d'onglet quote/escape (`'tab'!A1:...`) pour eviter les erreurs de parsing.

### Session 6 (2026-03-26) — Refonte recherche

13. **Remplacement Pappers → API Recherche d'Entreprises gouv.fr** : Pappers necessitait une API key + compte. Remplace par l'API gratuite du gouvernement (recherche-entreprises.api.gouv.fr). Sans cle, sans compte, 7 req/s illimite. Donnees SIRENE + RNE.

14. **Refonte pipeline recherche — 1 seul appel Claude** : Avant : 3-5 appels Claude sequentiels (Haiku) = 5-15s + 429. Apres : 1 appel Sonnet 4.6 + web search qui genere les filtres Fullenrich ET INSEE en 1 seul JSON. -36% de code (905 → 575 lignes).

15. **Claude web search** : Quand la description contient une URL, Claude utilise le tool `web_search_20250305` (Brave Search, $0.01/search) pour comprendre le business reel de l'entreprise. Remplace `fetchSiteContext` qui etait bloque par le proxy Netlify.

16. **Verification IA post-recherche** : `verifyBatch()` — Claude Haiku verifie chaque contact apres la recherche. Exclut les non-concurrents, filiales de groupes, agences classiques. Integre dans la boucle de pagination (re-fetch si trop d'exclusions).

17. **Filtre titres non-dirigeants** : Regex exclut automatiquement Product Owner, Commissaire aux comptes, Developer, Designer, Consultant, etc.

18. **Limite = contacts verifies** : Le champ "Nb resultats" controle le nombre de contacts POST-verification, pas les bruts.

19. **Auto-expand Google Sheets** : `ensureGridSize()` agrandit automatiquement la sheet quand elle est pleine (+500 lignes buffer). Plus de crash "Range exceeds grid limits".

20. **Multi-user + demo** : Roles admin/user/demo dans la sheet Users. Mode demo avec contacts simules (mix Fullenrich + INSEE). Hash bcrypt pour le mot de passe demo.

21. **Affichage cout IA** : Chaque recherche affiche le cout estimé ($X.XXX) a cote du raisonnement IA.

22. **Messages d'erreur explicites** : Plus de "Erreur interne" generique — le vrai message d'erreur est affiche dans l'UI.

### Session 5 (2026-03-24)

11. **Limite resultats 100 → 500** (`36449c9`)

12. **Flag et auto-exclusion des entreprises deja scorees** (`1444aac`)

### Session 4 (2026-03-22)

10. **Fix bugs campagne & analytics** (`427a4e1`) :
    - **Barre de progression > 100%** : Quand `sent` depasse `total_leads` (donnees desynchronisees), la barre debordait (350%). Cappee a 100% sur CampaignPage et AnalyticsPage.
    - **Statut "Brouillon" au lieu de "Terminee"** : Le statut `completed` n'etait pas gere dans CampaignPage — affichait "Brouillon" avec un badge orange. Ajoute le statut `completed` avec badge gris + label "Terminee".
    - **Analytics desynchronisees** : Le compteur `campaign.sent` (7) ne correspondait pas aux contacts ayant `email_status=sent` (1). `analytics.ts` utilise maintenant le max des deux pour eviter le sous-comptage.
    - **Date "1 janv. 1"** : Les dates invalides (annee < 2000) affichent "—" au lieu de dates absurdes.
    - **Params illisibles sur mobile** : L'affichage des parametres d'envoi en lecture seule (flex-wrap) melangeait les valeurs. Remplace par une grille 2 colonnes avec labels.
    - **Nettoyage** : Suppression du code en cours sur l'amelioration des campagnes (auto-pause sur metriques, campaign insights) — non termine et introduisait des colonnes supplementaires.

### Session 3 (2026-03-22)

9. **Fix espace en debut d'email** (`d5cab33`) — Les emails envoyes avaient un espace/retour a la ligne en debut de corps, ce qui faisait "trop IA". Ajout de `.trim()` sur le corps dans `send.ts`, `send-test.ts` et sur le resultat de `rewrite-template.ts`.

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

- **Sonnet pour les filtres, Haiku pour le reste** : `callClaudeCombined` utilise Sonnet 4.6 (raisonnement complexe + web search). Verification, scoring, phrases utilisent Haiku 4.5 (rapide, pas cher).
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

1. **Nettoyer les donnees corrompues** — Supprimer la campagne "Ecole de co a impact" (colonnes decalees) dans Google Sheets ou via l'interface, puis recreer une campagne propre.

2. **Relances automatiques** — Ajouter relance_1 et relance_2 avec delais configurables (J+3, J+7). Les templates existent deja dans `/templates/`.

3. **Export CSV** des contacts qualifies.

4. **Augmenter le rate limit Anthropic** — Le scoring est lent (~25 min pour 100 contacts a 5 req/min).

5. **Auto-pause sur metriques** — Pauser automatiquement une campagne si le bounce rate depasse 15% ou l'open rate est < 5% (code ebauche puis retire en session 4, a reimplementer proprement).

6. **Canal LinkedIn (2e canal de prospection)** — Ajouter LinkedIn comme canal d'outreach en complement de l'email. Decision prise : **extension Chrome maison** (Option B). Recherche effectuee sur les projets open source existants :
   - **[OpenOutreach](https://github.com/eracle/OpenOutreach)** (1.2k stars, Python, GPLv3) : Le plus complet. Playwright + stealth + API Voyager interne LinkedIn + ML (Gaussian Process) pour qualifier. Mais c'est un outil standalone serveur Docker, pas une extension Chrome. Potentiellement utilisable comme reference d'architecture.
   - **[LinkVit](https://github.com/Tchangang/LinkVit)** (JS, 2017, mort) : Extension Chrome simple — mass invitations + messages personnalises avec placeholders `%firstname%`, `%lastname%`. Bonne reference pour la structure manifest/content scripts.
   - **[Swapptoo/Linkedin-Automation-Extension](https://github.com/Swapptoo/Linkedin-Automation-Extension)** (React + Webpack) : Extension multi-navigateur auto-connect + message.
   - **[Harddiikk/Linkedin-Outreach](https://github.com/Harddiikk/Linkedin-Outreach)** (fork OpenOutreach, Python) : Utilise l'API Voyager pour les donnees structurees, Jinja templates pour messages perso.

   **Plan envisage** : Extension Chrome legere qui communique avec l'app via API pour recuperer la liste de prospects LinkedIn + messages IA personnalises. L'extension ouvre chaque profil, envoie l'invitation avec message perso, et reporte le statut. L'app a deja les URLs LinkedIn dans le champ `linkedin` des contacts. Points d'attention : fragilite (DOM LinkedIn change), rate limiting, risque de ban du compte LinkedIn.

   **Alternatives ecartees** :
   - *WhatsApp / SMS* : Prospection a froid interdite (WhatsApp TOS + RGPD/CNIL pour SMS sans opt-in). Utilisable uniquement en follow-up apres premier contact.
   - *Option C hybride* (copier-coller message + ouvrir profil LinkedIn) : Fallback possible si l'extension Chrome s'avere trop fragile.

## 7. Problemes connus

### Bugs identifies
- **Rate limit Anthropic 5 req/min** : Scoring lent. Le code gere ca (skip + retry) mais c'est une limitation.
- **Desync compteurs campagne** : Le compteur `campaign.sent` peut diverger du nombre reel de contacts avec `email_status=sent`. Le code analytics utilise `Math.max()` des deux pour compenser, mais la cause racine (ecriture concurrente ou echec partiel de `batchUpdateRows`) n'est pas resolue.
- **Donnees corrompues dans la sheet** : La campagne "Ecole de co a impact" a des colonnes decalees (`max_par_jour="active"`, `date_creation="01/01/1"`). Probablement causee par un changement de schema. Solution : supprimer et recreer la campagne.

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
