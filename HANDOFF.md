# DOCUMENT DE PASSATION — Prouesse Pipeline
*Mis a jour le : 2026-04-03*

## 0. Pour demarrer immediatement
```bash
git checkout claude/rebuild-search-feature-dzpFK   # Branche active
cd web
npm install
npm test            # 120 tests doivent passer
npx netlify dev     # Dev server local
```
**Branche de production Netlify** : `claude/rebuild-search-feature-dzpFK` (configuree dans Netlify → Build & deploy → Production branch)

## 1. Snapshot du projet
- **Nom & objectif** : Pipeline de prospection outbound automatise pour Prouesse. Recherche de dirigeants d'entreprises via Fullenrich, scoring IA (Pertinence + Impact), enrichissement email, envoi campagnes — tout depuis une interface web.
- **Proprietaire** : Adrien Pannetier — Prouesse (brand lie a Leveo / Lina Capital)
- **Stack** : React 19 + TypeScript + Vite 7 (frontend), Netlify Functions (backend serverless), Google Sheets (BDD), Anthropic Claude API (IA), Fullenrich API (recherche + enrichissement email), Brevo SMTP (envoi emails)
- **Repo** : `adrien416/ClayAvecClaude` — branche active : `claude/rebuild-search-feature-dzpFK`
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
│   │   │   ├── SearchPage.tsx    # Etape 1 : recherche simple (description → web search IA → Fullenrich)
│   │   │   ├── ScoringPage.tsx   # Etape 2 : scoring IA (Pertinence + Impact social/environnemental)
│   │   │   ├── EnrichPage.tsx    # Etape 3 : enrichissement email via Fullenrich
│   │   │   ├── CampaignPage.tsx  # Etape 4 : creation et envoi de campagne email
│   │   │   └── AnalyticsPage.tsx # Etape 5 : dashboard metriques multi-campagne
│   │   ├── components/           # Composants partages (Layout, ScoreBadge, Spinner, ConfirmDialog, CreditsDisplay)
│   │   ├── contexts/AuthContext.tsx  # Authentification JWT (cookie auth_token)
│   │   └── types/index.ts        # Types TypeScript
│   ├── netlify/functions/        # Backend serverless (Netlify Functions)
│   │   ├── _auth.ts              # Auth : login JWT, verification token, helper json()
│   │   ├── _sheets.ts            # CRUD Google Sheets (avec fallback cle chiffree via _google-key.ts)
│   │   ├── _google-key.ts        # Cle Google Service Account chiffree AES-256-GCM (dechiffree au runtime)
│   │   ├── _demo.ts              # Donnees mock pour le mode demo (contacts, scores, phrases, credits)
│   │   ├── search.ts             # POST /api/search — Sonnet 4.6 + web search → Fullenrich → verifyBatch → sauvegarde
│   │   ├── score.ts              # POST /api/score — scoring IA par contact (Pertinence + Impact)
│   │   ├── enrich.ts             # POST /api/enrich — enrichissement email via Fullenrich bulk API
│   │   ├── contacts.ts           # CRUD /api/contacts — lecture, creation, mise a jour, exclusion en masse
│   │   ├── campaign.ts           # CRUD /api/campaign — creation, liste, gestion multi-campagne + protection doublons domaine
│   │   ├── send.ts               # POST /api/send — envoi email via Brevo SMTP + anti-doublon
│   │   ├── generate-phrases.ts   # POST /api/generate-phrases — generation de phrases d'accroche IA
│   │   ├── rewrite-template.ts   # POST /api/rewrite-template — reecriture IA du template email (avec instructions utilisateur)
│   │   ├── analytics.ts          # GET /api/analytics — metriques campagne
│   │   ├── credits.ts            # GET /api/credits — solde credits Fullenrich
│   │   ├── login.ts              # POST /api/login — authentification
│   │   └── webhook-brevo.ts      # POST /api/webhook-brevo — webhook Brevo pour tracking
│   ├── tests/                    # Tests vitest (120 tests, 8 fichiers)
│   ├── netlify.toml              # Config Netlify
│   ├── package.json              # Dependances npm
│   └── vite.config.ts            # Config Vite
├── templates/                    # Templates email (premier_contact, relance_1, relance_2)
└── HANDOFF.md                    # Ce fichier
```

### Services externes connectes
| Service | Usage | Fichier |
|---------|-------|---------|
| **Anthropic Claude API** | Recherche web + filtres (Sonnet 4.6), verification contacts (Haiku), scoring (Haiku), phrases perso (Haiku), reecriture template (Haiku) | `search.ts`, `score.ts`, `generate-phrases.ts`, `rewrite-template.ts` |
| **Fullenrich API** | Recherche de personnes v2, enrichissement email bulk v1, credits | `search.ts`, `enrich.ts`, `credits.ts` |
| **Google Sheets API** | Base de donnees : onglets Contacts, Recherches, Campagnes, EmailLog, Users | `_sheets.ts` |
| **Brevo SMTP API** | Envoi d'emails transactionnels reels | `send.ts` |
| **Brevo Webhooks** | Tracking opens, clicks, bounces, unsubscribes | `webhook-brevo.ts` |

**Note : L'API INSEE/SIRENE a ete supprimee** (session 8). La recherche utilise uniquement Fullenrich.

### Variables d'environnement requises (Netlify)
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Cle API Anthropic (Claude) |
| `FULLENRICH_API_KEY` | Cle API Fullenrich |
| `GOOGLE_KEY_PASSPHRASE` | Passphrase pour dechiffrer la cle Google embarquee dans le code |
| `GOOGLE_SHEETS_ID` | ID du Google Spreadsheet |
| `JWT_SECRET` | Secret pour signer les tokens JWT |
| `LOGIN_PASSWORD_HASH` | Hash bcrypt du mot de passe admin |
| `BREVO_API_KEY` | Cle API Brevo (envoi emails) |
| `BREVO_WEBHOOK_SECRET` | Secret pour authentifier les webhooks Brevo |
| `LOGIN_EMAIL` | Email admin (fallback: adrien@prouesse.vc) |
| `SENDER_EMAIL` | Email expediteur Brevo |
| `SENDER_NAME` | Nom expediteur |

**Note :** `GOOGLE_SERVICE_ACCOUNT_KEY` (base64) n'est plus necessaire. La cle est chiffree dans `_google-key.ts` et dechiffree au runtime avec `GOOGLE_KEY_PASSPHRASE`. Le fallback env var fonctionne toujours si present.

### Schema Google Sheets
- **Contacts** (27 colonnes) : id, nom, prenom, email, entreprise, titre, domaine, secteur, linkedin, telephone, statut, enrichissement_status, enrichissement_retry, score_1, score_2, score_total, score_raison, score_feedback, recherche_id, campagne_id, email_status, email_sent_at, phrase_perso, source, date_creation, date_modification, user_id
- **Recherches** (7 colonnes) : id, description, mode, filtres_json, nb_resultats, date, user_id
- **Campagnes** (21 colonnes) : id, nom, recherche_id, template_sujet, template_corps, mode, status, max_par_jour, jours_semaine, heure_debut, heure_fin, intervalle_min, total_leads, sent, opened, clicked, replied, bounced, date_creation, user_id, user_role
- **EmailLog** : id, campagne_id, contact_id, brevo_message_id, status, sent_at, opened_at, clicked_at, replied_at
- **Users** : id, email, password_hash, nom, role (admin/user/demo), sender_email, sender_name

## 3. Ce qui fonctionne (tout est en production)

### Pipeline de recherche (refonte session 8 — simplifie)
```
POST /api/search (single endpoint, ~15-25s)
   1. Claude Sonnet 4.6 + web_search (max 3 recherches web)
      → Analyse l'industrie/les concurrents decrits par l'utilisateur
      → Genere des filtres Fullenrich (industries, titres, headquarters, specialties)
      → Retourne reasoning + filtres JSON
   2. Fullenrich API v2 people/search (1 batch, max 100)
      → Recherche contacts avec les filtres generes
      → Filtrage regex titres (exclut consultants, dev, PM, etc.)
      → Deduplication par entreprise
   3. Verification IA (Haiku) — seulement si budget temps le permet
      → Verifie chaque entreprise (pertinence, pas d'assos/public/coops)
      → Exclut : associations, ONG, fondations, entites publiques, cooperatives (SCOP, SCIC, mutuelles), filiales grands groupes
   4. Sauvegarde Google Sheets
      → Recherche + contacts
```

**Budget temps** : 22s (Netlify timeout 26s - 4s marge). Si l'IA + Fullenrich prennent trop de temps, la verification est sautee.

**Retry auto** : 3 tentatives avec backoff (3s/6s/9s) pour les erreurs 429 (rate limit) et 529 (surcharge).

**Exclusions automatiques** :
- Associations, ONG, fondations, entites caritatives
- Entites publiques (mairies, collectivites, hopitaux publics, universites publiques)
- Cooperatives (SCOP, SCIC, mutuelles, cooperatives agricoles)
- Filiales de grands groupes / CAC40 / multinationales
- Cabinets d'audit, conseil, banques d'affaires, fonds d'investissement
- Titres non-dirigeants (consultant, developer, PM, data analyst, etc.)

**Couts** : ~$0.02-0.05 par recherche (Sonnet web search + Haiku verify)
**Modeles** : Sonnet 4.6 (recherche + filtres), Haiku 4.5 (verification + scoring + phrases)

### Scoring IA (session 8 — nouveaux criteres)
- **Critere 1 : Pertinence** (1-5) — L'entreprise correspond-elle au secteur recherche ?
- **Critere 2 : Impact social & environnemental** (1-5) — Impact positif mesurable ?
- **Total /10** — Seuil qualification : >= 7/10
- **Plus de modes** : Les modes "levee de fonds" et "cession" ont ete supprimes
- **Plus de "Scalabilite"** ni de "Potentiel cession"
- Feedback utilisateur integre (apprentissage du scoring)
- Reutilisation du score par domaine (meme entreprise = meme score)

### Fonctionnalites recherche
- **UI simplifiee** : 1 champ texte + 1 bouton "Rechercher"
- **Bouton "Chercher plus"** : ajoute 100 contacts supplementaires (offset/pagination Fullenrich)
- **Panel raisonnement IA** : affiche l'analyse IA, les filtres Fullenrich envoyes, les stats de verification (X bruts → Y verifies → Z finaux), le cout
- **Recherches precedentes** : boutons "Voir" (charge contacts inline), "Scoring", "Enrichir"
- **Exclusion manuelle** : checkbox par contact
- **Tous les onglets accessibles** : plus de verrouillage sequentiel
- **Fallback auto** : si Fullenrich retourne < 10 resultats, relance sans specialties/founded_year et headcount elargi
- **Industries exclues en dur** : Non-profit, Government, Public Policy, Civic & Social, Political, Military (hardcode dans le code, meme si l'IA oublie)

### Pipeline complet (5 etapes)
1. **Recherche** : Description libre → IA + web search → Fullenrich → contacts. Bouton "Chercher plus" pour paginer.
2. **Scoring IA** : Pertinence + Impact (Haiku). Instructions personnalisables avant lancement. Reutilisation par domaine. Feedback apprentissage global (TOUS les feedbacks de TOUTES les recherches). Estimation du cout affichee.
3. **Enrichissement email** : Fullenrich bulk API
4. **Campagne email** : Multi-campagne, noms personnalisables (click-to-edit), protection doublons domaine, phrases IA editables dans la preview, reecriture template IA avec instructions utilisateur, estimation cout phrases IA, envoi Brevo reel, plage horaire
5. **Analytics** : Dashboard multi-campagne, metriques, graphe quotidien

### Fonctionnalites transversales
- **Cle Google chiffree** : `_google-key.ts` contient la cle AES-256-GCM, dechiffree avec `GOOGLE_KEY_PASSPHRASE`
- **Google Sheets persistence** : `getHeadersForWrite` synchronise automatiquement les colonnes
- **Navigation libre** : Tous les 5 onglets sont toujours cliquables
- **Authentification** : JWT cookie, roles admin/user/demo
- **Mode demo** : Contacts fictifs, scores simules, pas d'appels reels aux APIs

## 4. Historique des changements

### Session 8 (2026-04-03) — Rebuild recherche + suppression modes

26. **Rebuild complet de la recherche** : Remplacement du pipeline 3 etapes (search-filters → search-competitors → search) par un seul endpoint. Suppression d'INSEE. Web search integre directement dans l'endpoint search.ts.

27. **Suppression des modes levee_de_fonds / cession** : Plus de selecteur de mode. Le scoring utilise desormais Pertinence + Impact (au lieu de Scalabilite/Impact ou Impact env./Potentiel cession).

28. **Cle Google chiffree dans le code** : `_google-key.ts` avec AES-256-GCM. Variable `GOOGLE_KEY_PASSPHRASE` remplace `GOOGLE_SERVICE_ACCOUNT_KEY` (trop longue pour Netlify).

29. **Panel raisonnement IA** : SearchPage affiche l'analyse IA, les filtres Fullenrich, les stats de verification, le cout.

30. **Onglets deverrouilles** : Les 5 onglets sont toujours accessibles (plus de verrouillage progressif).

31. **Noms de campagne editables** : Click-to-edit sur le nom de la campagne (Enter pour sauver, Escape pour annuler).

32. **Instructions IA pour reecriture template** : Champ "Instructions IA" dans CampaignPage pour guider la reecriture (ex: "rends le ton plus decontracte").

33. **Phrase IA editable** : Bouton "Modifier" dans la preview email pour corriger la phrase personnalisee IA.

34. **Exclusion assos/public/coops** : Prompt de recherche et verification excluent explicitement associations, entites publiques, cooperatives.

35. **Fix timeout 504** : Budget temps 22s, verification IA sautee si temps insuffisant, 1 seul batch Fullenrich, suppression auto-retry.

36. **Retry 429/529** : 3 tentatives avec backoff pour les erreurs Anthropic.

37. **Parsing JSON robuste** : Extracteur par comptage de brackets (plus de regex gourmand), support code fences markdown, utilisation du dernier bloc texte.

38. **Demo mise a jour** : Raisons de scoring adaptees aux nouveaux criteres (Pertinence + Impact), template email mis a jour.

39. **Tests** : 120 tests (8 fichiers), dont 25 tests search couvrant : validation, succes, multi-contacts, filtrage titres, deduplication, 0 resultats, parsing JSON (code fences, multi-block), retry 429/529, erreurs API.

40. **Bouton "Chercher plus"** : Pagination Fullenrich via offset. Ajoute 100 contacts aux resultats existants.

41. **Instructions de scoring personnalisables** : Champ texte editable avant de lancer le scoring. Les instructions sont passees au prompt IA en plus des criteres standards.

42. **Apprentissage global** : Le scoring utilise TOUS les feedbacks de TOUTES les recherches (plus de limite de 10, plus de restriction a la recherche en cours).

43. **Estimation cout** : Scoring affiche le nombre d'appels IA (domaines uniques) + cout estime. Campagne affiche le cout des phrases IA.

44. **Filtres larges par defaut** : Prompt IA demande 2-5 industries LinkedIn larges, headcount 1-5000, pas de specialties sauf recherche concurrents. Fallback auto si < 10 resultats.

45. **Exclusions hardcodees** : Industries Non-profit, Government, Public Policy, Civic & Social, Political, Military toujours exclues dans les filtres Fullenrich (code, pas juste prompt).

46. **Dark theme** : Interface complete en fond noir (#0f1117), cards en gris fonce (#161822), logo Prouesse avec icone gradient bleu.

**Fichiers supprimes** : `search-filters.ts`, `search-competitors.ts`, `_search-ai.ts` (integres dans search.ts)

### Sessions precedentes (1-7)
Voir historique git pour le detail. Points cles :
- Session 7 : Robustesse Google Sheets (auto-creation onglets)
- Session 6 : Refonte recherche (3 etapes, INSEE, web search)
- Session 5 : Limite resultats, auto-exclusion
- Session 4 : Fix bugs campagne & analytics
- Session 3 : Fix email, webhook Brevo, audit securite
- Session 2 : Fix Sheets, scoring doublons, multi-campagne
- Session 1 : Creation du projet

## 5. Decisions non evidentes

- **Sonnet pour la recherche, Haiku pour le reste** : La recherche utilise Sonnet 4.6 avec web_search. Verification, scoring, phrases, reecriture utilisent Haiku 4.5.
- **Budget temps 22s** : Netlify a 26s de timeout. La verification IA est sautee si le temps restant < 8s.
- **Plus de mode levee/cession** : Decision utilisateur. Le champ `mode` existe encore dans les Sheets (legacy) mais n'est plus utilise.
- **Cle Google dans le code** : Chiffree AES-256-GCM, pas en clair. Dechiffree avec un mot de passe court en env var.
- **1 contact par appel API send** : Chaque appel a `/api/send` envoie 1 email (contrainte timeout Netlify). Le frontend boucle cote client.
- **Google Sheets comme BDD** : Choix delibere pour que le client puisse voir/editer les donnees directement.
- **Score 0 est valide** : `score_total=0` = score mais non qualifie. `score_total=""` = pas encore score.
- **`email_status: "skipped_duplicate"`** : Contacts dont le domaine etait deja contacte dans une autre campagne.
- **Brevo est reel** : `send.ts` envoie de VRAIS emails. Pas de mode dry-run.

## 6. Problemes connus

### Bugs identifies
- **Rate limit Anthropic** : Le scoring est lent (~25 min pour 100 contacts a 5 req/min). Le code gere ca (skip + retry).
- **Desync compteurs campagne** : Le compteur `campaign.sent` peut diverger du nombre reel. Analytics utilise `Math.max()` pour compenser.

### Securite (risques acceptes)
- **Webhook secret en query param** : Pattern standard Brevo. Risque faible.
- **Pas de rate limiting** : Endpoints proteges par auth JWT uniquement.

### Dette technique
- **`readAll` a chaque appel** : Lit TOUTE la feuille Contacts. OK pour < 1000 contacts.
- **Champ `mode` legacy** : Existe dans les Sheets mais n'est plus utilise par le code.

## 7. Comment reprendre ce projet

### Commandes pour demarrer
```bash
git checkout claude/rebuild-search-feature-dzpFK
cd web
npm install
npx netlify dev     # Dev server local
npm test            # 120 tests vitest
```

### Variables d'env requises pour le dev local
Creer `web/.env` avec :
```
GOOGLE_KEY_PASSPHRASE=ProuesseP1peline2026!
GOOGLE_SHEETS_ID=<ID du spreadsheet>
FULLENRICH_API_KEY=<cle Fullenrich>
ANTHROPIC_API_KEY=<cle Anthropic>
JWT_SECRET=<secret JWT>
LOGIN_PASSWORD_HASH=<hash bcrypt>
BREVO_API_KEY=<cle Brevo>
BREVO_WEBHOOK_SECRET=<secret webhook Brevo>
```

### Premiere action
Verifier que la recherche fonctionne : taper "startups dans l'agritech" → verifier que des contacts apparaissent avec le raisonnement IA.

## 8. Contraintes design & marque

- **Marque** : Prouesse (pas Leveo, pas Lina Capital dans l'interface)
- **Theme** : Dark mode — fond noir (#0f1117), cards gris fonce (#161822), texte clair
- **Couleurs** : Bleu primaire (`blue-600`), vert pour validation (`green-600`), rouge pour erreurs
- **Ton** : Professionnel, en francais, tutoiement dans les emails
- **Header** : Logo "P" gradient bleu + "Prouesse Pipeline" + credits Fullenrich + deconnexion
- **Tabs** : 5 onglets numerotes, tous toujours accessibles
- **Scoring** : Pertinence (1-5) + Impact social/environnemental (1-5) = total /10, seuil >= 7
- **Exclusions recherche** : Pas d'associations, pas d'entites publiques, pas de cooperatives, pas de Non-profit, pas de Government

## 9. Preferences utilisateur (Adrien)

**Architecture** :
- Garder les choses simples. Pas de pipeline multi-etapes complexe. 1 endpoint = 1 action.
- Ne PAS splitter les appels frontend/backend sauf absolue necessite (ca plante sinon).
- Preferer sauter des etapes optionnelles (verification IA) plutot que risquer un timeout.

**Recherche** :
- Filtres larges par defaut. Mieux vaut trop de resultats que pas assez.
- Industries LinkedIn larges (pas de niches).
- Pas de specialties sauf recherche de concurrents specifiques.
- Toujours exclure : associations, ONG, entites publiques, cooperatives, filiales grands groupes.
- Hardcoder les exclusions dans le code (ne pas faire confiance uniquement au prompt IA).

**Scoring** :
- L'utilisateur doit pouvoir personnaliser le prompt avant de lancer.
- Afficher le cout estime avant de lancer.
- Apprentissage global : utiliser TOUS les feedbacks de TOUTES les recherches.

**Campagne** :
- L'utilisateur doit pouvoir editer les phrases IA individuellement.
- L'utilisateur doit pouvoir guider la reecriture du template avec des instructions.
- Afficher le cout des phrases IA.
- Boutons assez gros pour mobile (min 44px hauteur).

**General** :
- Toujours faire les tests (vitest) avant de push.
- Ne pas casser ce qui marche deja.
- Mode demo doit fonctionner sans appels API reels.
