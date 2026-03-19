# DOCUMENT DE PASSATION — Prouesse Pipeline
*Genere le : 2026-03-19*

## 1. Snapshot du projet
- **Nom & objectif** : Pipeline de prospection outbound automatise pour Prouesse. L'outil permet de rechercher des dirigeants d'entreprises (via Fullenrich), de les scorer par IA selon des criteres de scalabilite/impact ou cession, d'enrichir leurs emails, puis d'envoyer des campagnes email personnalisees — le tout depuis une interface web.
- **Proprietaire** : Adrien Pannetier — Prouesse (brand lie a Leveo / Lina Capital)
- **Stack** : React 19 + TypeScript + Vite 7 (frontend), Netlify Functions (backend serverless), Google Sheets (BDD), Anthropic Claude API (IA), Fullenrich API (recherche + enrichissement email), Brevo SMTP (envoi emails)
- **Repo** : `adrien416/ClayAvecClaude` — branche active : `claude/outbound-prospecting-pipeline-BkDZA`
- **Deploy** : Netlify (auto-deploy depuis le repo). Build : `npm run build` dans `/web`, publie `/web/dist`

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
│   │   │   └── AnalyticsPage.tsx # Etape 5 : dashboard metriques (sent, opened, clicked, replied)
│   │   ├── components/           # Composants partages (Layout, ScoreBadge, Spinner, ConfirmDialog, CreditsDisplay)
│   │   ├── contexts/AuthContext.tsx  # Authentification JWT (cookie auth_token)
│   │   └── types/index.ts        # Types TypeScript
│   ├── netlify/functions/        # Backend serverless (Netlify Functions)
│   │   ├── _auth.ts              # Auth : login JWT, verification token, helper json()
│   │   ├── _sheets.ts            # CRUD Google Sheets (readAll, appendRow, updateRow, batchUpdateRows, findRowById)
│   │   ├── search.ts             # POST /api/search — Claude Haiku traduit description → filtres Fullenrich → sauvegarde contacts
│   │   ├── score.ts              # POST /api/score — scoring IA par contact (Haiku pour levee, Opus pour cession)
│   │   ├── enrich.ts             # POST /api/enrich — enrichissement email via Fullenrich bulk API
│   │   ├── contacts.ts           # CRUD /api/contacts — lecture, creation, mise a jour, exclusion en masse
│   │   ├── campaign.ts           # CRUD /api/campaign — creation et gestion de campagnes
│   │   ├── send.ts               # POST /api/send — envoi email via Brevo SMTP + phrase perso generee par IA
│   │   ├── analytics.ts          # GET /api/analytics — metriques campagne (sent, opened, clicked, replied, daily)
│   │   ├── credits.ts            # GET /api/credits — solde credits Fullenrich
│   │   ├── login.ts              # POST /api/login — authentification
│   │   └── webhook-brevo.ts      # POST /api/webhook-brevo — webhook Brevo pour tracking (opens, clicks, bounces)
│   ├── tests/                    # Tests vitest pour les Netlify Functions (102 tests)
│   ├── netlify.toml              # Config Netlify (build command, publish dir)
│   ├── package.json              # Dependances npm
│   └── vite.config.ts            # Config Vite
├── scripts/                      # Pipeline Python CLI (version originale, plus utilisee activement)
├── tests/                        # Tests Python pour le pipeline CLI
├── config.yaml                   # Config YAML du pipeline (secteurs, limites, parametres d'envoi)
├── templates/                    # Templates email (premier_contact, relance_1, relance_2)
└── HANDOFF.md                    # Ce fichier
```

### Services externes connectes
| Service | Usage | Fichier |
|---------|-------|---------|
| **Anthropic Claude API** | Traduction description → filtres (Haiku), scoring contacts (Haiku/Opus), generation phrase perso (Haiku) | `search.ts`, `score.ts`, `send.ts` |
| **Fullenrich API v2** | Recherche de personnes (`/api/v2/people/search`), enrichissement email bulk (`/api/v1/contact/enrich/bulk`), credits (`/api/v1/account/credits`) | `search.ts`, `enrich.ts`, `credits.ts` |
| **Google Sheets API** | Base de donnees : onglets Contacts, Recherches, Campagnes, EmailLog, Fonds, Scoring | `_sheets.ts` |
| **Brevo SMTP API** | Envoi d'emails transactionnels | `send.ts` |

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

### Schema Google Sheets
- **Contacts** (23 colonnes) : id, nom, prenom, email, entreprise, titre, domaine, secteur, linkedin, telephone, statut, enrichissement_status, score_1, score_2, score_total, score_raison, recherche_id, campagne_id, email_status, email_sent_at, phrase_perso, date_creation, date_modification
- **Recherches** : id, description, mode, filtres_json, nb_resultats, date
- **Campagnes** : id, nom, template_sujet, template_corps, mode, status, max_par_jour, jours_semaine, heure_debut, heure_fin, intervalle_min, total_leads, sent, opened, clicked, replied, bounced, date_creation
- **EmailLog** : id, campagne_id, contact_id, brevo_message_id, status, sent_at, opened_at, clicked_at, replied_at

## 3. Ce qui a ete fait cette session (chronologique)

1. **Rewrite complet en 6 etapes** (`3617a6e`) — Refonte de l'interface en pipeline : Recherche → Scoring → Enrichissement → Campagne → Analytics. Remplacement de l'architecture precedente (Clay + dashboard CLI Python) par une app web React + Netlify Functions.

2. **Fix endpoint Fullenrich** (`6db97b0`) — L'API Fullenrich v2 utilise `/api/v2/people/search` (pas v1). Format requete/reponse corrige.

3. **Rate limit + label Fullenrich + limit configurable** (`42ad8f5`) — Ajout retry sur 429, correction du label "Fullenrich" dans le header, champ "Nb resultats" configurable.

4. **Prevention des 504 timeouts** (`3e1a186`, `c6fbaee`) — Reduction du batch scoring a 3 contacts/appel, puis a 1 contact/appel pour rester dans le timeout Netlify (26s).

5. **Exclusion auto des organismes non pertinents** (`8a4fe20`, `038293f`) — Ajout dans le prompt Claude : exclure associations, cooperatives, charities, organismes publics, banques d'affaires, cabinets M&A, et filiales de grands groupes (RATP Solutions Ville, Engie Green...).

6. **Rate limit strict 1 contact / 13s puis 15s** (`28544a2`) — Adaptation au rate limit Anthropic de 5 req/min pour l'org. Ajout estimation du cout IA dans l'UI.

7. **Gestion gracieuse des 429** (`8275536`) — Au lieu de crasher sur rate limit, le scoring skip le contact et le retente au cycle suivant.

8. **Exclusion manuelle de contacts** (`30c877a`) — Bouton "x" par contact dans les resultats de recherche. Les contacts exclus sont marques `statut=exclu` dans Google Sheets et ignores par le scoring.

9. **Fix 504 sur recherche + propagation du mode** (`d9cc486`) — Switch du modele Claude dans `search.ts` de Opus a Haiku (beaucoup plus rapide). Fix du mode (levee_de_fonds/cession) qui etait hardcode et jamais propage de la recherche au scoring.

10. **Affichage des filtres IA** (`ae00587`) — Les filtres generes par Claude sont affiches sous forme de tags colores entre le formulaire et les resultats (bleu = inclus, rouge barre = exclus).

11. **Suite de tests vitest pour le web** (`62bd490`) — 96 tests (maintenant 102) couvrant toutes les Netlify Functions : auth, sheets, contacts, score, search, enrich, campaign, analytics. Framework vitest ajoute au projet.

12. **Suggestions IA quand 0 resultats** (`73adcf0`) — Quand Fullenrich ne trouve rien, l'IA propose 3-5 modifications concretes pour elargir la recherche. Affichees dans un bloc amber sous les filtres.

13. **Amelioration majeure de la qualite des filtres + auto-retry** — Trois changements importants dans `search.ts` :
    - **Prompt IA reecrit** : Le system prompt force maintenant l'IA a utiliser des termes anglais LinkedIn (Fullenrich utilise la taxonomie LinkedIn), a limiter a 2-3 industries larges, max 3 titres, et `exact_match: false` partout. Avant, l'IA generait des termes francais niches ("recyclage", "dechets electroniques") qui ne matchaient rien.
    - **Auto-retry avec filtres elargis** : Quand la premiere recherche retourne 0 resultats, le systeme genere automatiquement des filtres plus larges (via un prompt specifique "RECHERCHE ELARGIE") et retente Fullenrich. Si le retry reussit, les filtres elargis sont utilises et l'UI affiche "Filtres elargis automatiquement".
    - **Suggestions seulement en dernier recours** : Les suggestions IA ne sont affichees que si le retry a aussi echoue (0 resultats apres 2 tentatives).

### Decisions non evidentes
- **Haiku pour la recherche, Opus pour le scoring cession** : La traduction description → JSON est triviale, Haiku suffit. Le scoring cession necessite une analyse plus fine (signaux de vente), donc Opus. Le scoring levee de fonds utilise Haiku car les criteres sont plus simples.
- **1 contact par appel API** : Le rate limit Anthropic est de 5 req/min pour cette org. Avec le polling frontend toutes les 15s, ca fait ~4 req/min, juste sous la limite.
- **Google Sheets comme BDD** : Choix delibere pour que le client puisse voir/editer les donnees directement. Pas prevu pour du volume > quelques milliers de contacts.
- **Brevo plutot que HubSpot pour l'envoi** : Le code `send.ts` utilise Brevo SMTP. HubSpot est mentionne dans le pipeline Python original mais n'est pas integre dans la version web.
- **Industries en anglais dans le prompt de recherche** : Fullenrich utilise la taxonomie LinkedIn qui est en anglais. Le prompt force explicitement l'IA a traduire les termes francais (ex: "recyclage de dechets" → "Environmental Services"). Sans ca, les recherches niches retournent 0 resultats.
- **Auto-retry avec 2 prompts differents** : La fonction `buildSystemPrompt(mode, broad)` genere un prompt different selon que c'est le premier essai ou le retry. Le retry ajoute des instructions explicites pour elargir (1 seule industrie large, max 2 titres, pas de specialties).
- **Tests vitest pour le backend** : 102 tests unitaires couvrent les Netlify Functions. Les tests mockent `fetch` (Anthropic, Fullenrich), `_sheets` (Google Sheets), et `_auth` (JWT). Les tests Python (177) couvrent le pipeline CLI original.

## 4. Etat actuel — EN COURS

### Tache en cours
Aucune tache specifique en cours. L'app est fonctionnelle sur les 5 etapes. Tests : 177 Python + 102 TypeScript = 279 tests passent.

### Ce qui fonctionne
- Recherche de prospects (description francais → filtres Fullenrich en anglais LinkedIn → resultats)
- Auto-retry avec filtres elargis quand 0 resultats (2 tentatives avant suggestions)
- Suggestions IA concretes quand les 2 tentatives echouent
- Affichage des filtres IA generes (vert si elargis automatiquement)
- Exclusion manuelle de contacts avant validation
- Scoring IA avec gestion du rate limit (skip + retry)
- Enrichissement email via Fullenrich bulk
- Creation de campagne email
- Envoi d'emails via Brevo avec phrase perso generee par IA
- Dashboard analytics

### Ce qui n'est PAS teste en production
- L'envoi reel d'emails (Brevo) — la cle API `BREVO_API_KEY` doit etre configuree
- Le webhook Brevo pour le tracking (opens, clicks, bounces)
- L'enrichissement Fullenrich avec un volume > 10 contacts

## 5. Prochaines etapes (par priorite)

1. **Tester l'envoi email de bout en bout** — Configurer `BREVO_API_KEY` dans Netlify, creer une campagne test avec 2-3 contacts, verifier que les emails partent et que le tracking fonctionne.

2. **Ajouter la persistance du `rechercheId` dans l'URL ou localStorage** — Actuellement, si l'utilisateur rafraichit la page apres l'etape 1, le `rechercheId` est perdu et il doit refaire la recherche. Stocker dans `localStorage` ou dans un query param.

3. **Ajouter un selecteur de recherches precedentes** — Permettre de charger une recherche deja faite au lieu de toujours en lancer une nouvelle. Utile pour reprendre le scoring ou l'enrichissement.

4. **Augmenter le rate limit Anthropic** — Contacter Anthropic pour passer de 5 req/min a un tier superieur. Le scoring de 100 contacts prend actuellement ~25 min.

5. **Migrer de Brevo vers HubSpot pour l'envoi** — Le CRM HubSpot est deja configure (cf `config.yaml`). Migrer `send.ts` pour utiliser l'API HubSpot au lieu de Brevo permettrait de centraliser le tracking.

- [ ] Ajouter des relances automatiques (relance_1, relance_2) avec delais configurables
- [ ] Ajouter le scoring en batch quand le rate limit sera leve
- [ ] Implementer la deduplication de contacts entre recherches
- [ ] Ajouter un export CSV des contacts qualifies
- [ ] Ajouter le support multi-utilisateurs (actuellement login unique adrien@prouesse.vc)

## 6. Problemes connus & attention

### Bugs identifies
- **Rate limit Anthropic 5 req/min** : Le scoring est tres lent (~25 min pour 100 contacts). Le code gere ca gracieusement (skip + retry) mais c'est une limitation forte. Solution : augmenter le tier ou utiliser un modele sans rate limit.
- **Pas de persistance du state entre rechargements** : Le `rechercheId` et le `searchMode` sont dans le state React. Un F5 les perd.

### Dette technique
- **`_sheets.ts` fait un `readAll` a chaque appel** : Ca lit TOUTE la feuille Contacts a chaque scoring/enrichissement. Acceptable pour < 1000 contacts, problematique au-dela.
- **Le mode scoring "cession" utilise Opus** (`score.ts:94`) : C'est voulu (analyse plus fine), mais Opus est beaucoup plus cher ($0.015/req vs $0.0003 pour Haiku) et plus lent. Le client doit etre conscient du cout.
- **`send.ts` utilise Brevo avec l'email hardcode** (`adrien@prouesse.vc`) en ligne 121 : Pas configurable.
- **Le login est hardcode** (`_auth.ts:6`) : Email `adrien@prouesse.vc` en dur. Le hash du mot de passe est dans une variable d'env mais l'email non.

### Cas limites non geres
- Contacts sans domaine : le scoring marche mais la meta-description est vide, donc le score est moins precis.
- Contacts en double entre deux recherches differentes : pas de deduplication.

### Ce qui parait bizarre mais est intentionnel
- **`statut: "exclu"` plutot que suppression** : Les contacts exclus restent dans Google Sheets avec `statut=exclu`. Ils sont filtres cote serveur. Ca permet de les retrouver si besoin.
- **Le scoring retourne `score_total: 0` sur rate limit** : C'est un signal de skip, pas un vrai score. Le code verifie `scores.score_total === 0 && !scores.raison` pour distinguer un skip d'un vrai score de 0.

## 7. Contraintes design & marque

- **Marque** : Prouesse (pas Leveo, pas Lina Capital dans l'interface)
- **Couleurs** : Bleu primaire (`blue-600`), vert pour validation (`green-600`), rouge pour erreurs/exclusion, gris pour disabled
- **Police** : Tailwind CSS defaults (Inter via system fonts)
- **Ton** : Professionnel, en francais, pas de tutoiement dans les emails generes, tutoiement dans l'interface
- **Header** : Logo "Prouesse" + "Pipeline" + affichage credits Fullenrich + bouton deconnexion
- **Tabs** : 5 onglets numerotes (1. Recherche, 2. Scoring, 3. Enrichissement, 4. Campagne, 5. Analytics)
- **Ne PAS changer** : L'ordre des onglets, le schema Google Sheets (les colonnes sont utilisees par le client directement), le format des prompts de scoring (valides avec le client)

## 8. Comment reprendre ce projet

### Pour un nouveau developpeur
1. Lire ce fichier (`HANDOFF.md`) en entier
2. Lire `web/src/App.tsx` pour comprendre le flux entre les etapes
3. Lire `web/netlify/functions/_sheets.ts` pour comprendre la couche BDD
4. Lire `web/netlify/functions/score.ts` pour comprendre le scoring IA

### Commandes pour demarrer
```bash
cd web
npm install
npx netlify dev     # Lance le dev server local (frontend + functions)
npm test            # Lance les 102 tests vitest (Netlify Functions)
cd .. && python -m pytest tests/  # Lance les 177 tests Python (pipeline CLI)
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
```

### Premiere action
Verifier que le scoring fonctionne correctement avec le rate limit actuel (5 req/min). Lancer une recherche test avec 5 contacts, scorer, et verifier que les scores apparaissent dans Google Sheets.
