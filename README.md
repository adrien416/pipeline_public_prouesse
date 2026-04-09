# Prouesse Pipeline

**Votre pipeline de prospection B2B automatisé, propulsé par l'IA.**

Trouvez des contacts, scorez-les, enrichissez leurs emails, et envoyez des campagnes personnalisées — le tout depuis une seule interface. Sans savoir coder.

Créé par [Prouesse](https://prouesse.vc).

---

## Installer votre pipeline (~15 min)

### Avant de commencer

Vous allez avoir besoin de 5 comptes. Créez-les maintenant, ça prend 5 minutes :

| # | Service | A quoi ça sert | Coût | Lien |
|---|---------|---------------|------|------|
| 1 | **Netlify** | Héberge votre app (comme un serveur) | Gratuit (125K appels/mois) | [Créer un compte](https://app.netlify.com/signup) |
| 2 | **GitHub** | Stocke le code (Netlify en a besoin) | Gratuit | [Créer un compte](https://github.com/signup) |
| 3 | **Anthropic** | L'IA qui fait la recherche et le scoring | Payant (~5€ pour démarrer) | [Créer un compte](https://console.anthropic.com/) |
| 4 | **Fullenrich** | Trouve les emails pros de vos contacts | 50 emails gratuits | [Créer un compte](https://fullenrich.com?via=wDRTwS1HGWy5) |
| 5 | **Brevo** | Envoie vos emails de prospection | 300 emails/jour gratuits | [Créer un compte](https://app.brevo.com/account/register) |

Vous aurez aussi besoin d'un **Google Sheet** (gratuit) — l'app vous guide pour ça.

---

### Etape 1 : Déployer l'app (2 min)

1. Cliquez sur ce bouton :

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/adrien416/pipeline_public_prouesse)

2. Netlify vous demande de vous connecter — utilisez votre compte Netlify
3. Il vous demande de connecter GitHub — acceptez
4. Cliquez **"Deploy"** et attendez ~1 minute
5. Quand c'est fini, cliquez sur l'URL de votre site (genre `https://votre-site-12345.netlify.app`)

---

### Etape 2 : Créer votre compte admin (3 min)

Quand vous ouvrez votre site pour la première fois, vous voyez la page **"Créer mon compte"**.

**a) Connecter Netlify :**

1. Allez sur [app.netlify.com → Personal Access Tokens](https://app.netlify.com/user/applications#personal-access-tokens)
2. Cliquez **"New access token"**
3. Donnez-lui un nom (ex: "Pipeline") → cliquez **"Generate token"**
4. Copiez le token (la longue chaîne de caractères)
5. Collez-le dans l'app → cliquez **"Connecter"**
6. Sélectionnez votre site dans la liste → **"Continuer"**

**b) Créer votre compte :**

1. Entrez votre email et un mot de passe (8 caractères minimum)
2. Cliquez **"Créer mon compte"**
3. L'app configure tout automatiquement (~2 min)
4. Quand c'est prêt, cliquez **"Se connecter"**

---

### Etape 3 : Configurer les clés API (10 min)

Après vous être connecté, l'app vous guide étape par étape.

**Clé Anthropic (Claude) :**
1. Allez sur [console.anthropic.com → API Keys](https://console.anthropic.com/settings/keys)
2. Cliquez **"Create Key"** → copiez la clé (commence par `sk-ant-...`)
3. Collez-la dans l'app → **"Tester la connexion"**

**Clé Fullenrich :**
1. Allez sur [app.fullenrich.com → Settings → API](https://app.fullenrich.com/settings)
2. Copiez votre clé API
3. Collez-la dans l'app → **"Tester la connexion"**

**Clé Brevo :**
1. Allez sur [app.brevo.com → SMTP & API](https://app.brevo.com/settings/keys/api)
2. Cliquez **"Generate a new API key"** → copiez-la (commence par `xkeysib-...`)
3. Collez-la dans l'app + entrez votre email d'expéditeur et votre nom
4. Cliquez **"Tester la connexion"**

**Google Sheets (la partie la plus longue, ~5 min) :**

L'app vous guide, mais voici le résumé :

1. Allez sur [console.cloud.google.com](https://console.cloud.google.com)
2. Créez un nouveau projet (bouton en haut → "New Project" → donnez-lui un nom → "Create")
3. Activez l'API Google Sheets :
   - Menu hamburger (les 3 barres en haut à gauche) → **"APIs & Services"** → **"Library"**
   - Cherchez **"Google Sheets API"** → cliquez dessus → **"Enable"**
4. Créez un Service Account :
   - Menu → **"IAM & Admin"** → **"Service Accounts"** → **"Create Service Account"**
   - Donnez un nom → **"Create and Continue"** → **"Done"**
5. Créez une clé :
   - Cliquez sur le service account que vous venez de créer
   - Onglet **"Keys"** → **"Add Key"** → **"Create New Key"** → **JSON** → **"Create"**
   - Un fichier `.json` se télécharge — gardez-le
6. Créez un Google Sheet :
   - Allez sur [sheets.new](https://sheets.new) (crée un nouveau Sheet)
   - Copiez l'ID du Sheet : c'est la partie entre `/d/` et `/edit` dans l'URL
   - Cliquez **"Partager"** → ajoutez l'email du service account (il ressemble à `nom@projet.iam.gserviceaccount.com`) en tant qu'**Editeur**
7. Dans l'app :
   - Uploadez le fichier `.json` téléchargé à l'étape 5
   - Collez l'ID du Sheet
   - Cliquez **"Enregistrer"**

---

### Etape 4 : C'est prêt !

Cliquez **"Redéployer et lancer le pipeline"**. Après ~2 minutes, votre pipeline est opérationnel.

**Pour lancer votre première recherche :**
1. Décrivez votre cible (ex: "Fondateurs de startups cleantech en France, levée de fonds récente")
2. L'IA trouve les contacts correspondants
3. Scorez-les automatiquement
4. Enrichissez les emails des meilleurs contacts
5. Créez et envoyez votre campagne personnalisée

---

## Besoin d'aide ?

| Problème | Solution |
|----------|----------|
| Je vois "Se connecter" au lieu de "Créer mon compte" | Faites Ctrl+Maj+R pour forcer le rechargement de la page |
| "Non authentifié" après connexion | Votre session a expiré. Reconnectez-vous |
| La recherche ne trouve rien | Essayez une description plus large ou vérifiez votre clé Anthropic |
| Les emails ne s'envoient pas | Vérifiez que votre domaine d'expédition est validé dans Brevo |

**Contact :** adrien@prouesse.vc

---

## Sécurité

- Vos clés API sont chiffrées dans Netlify (jamais dans le code)
- Vos mots de passe sont hashés (personne ne peut les lire)
- Chaque instance est 100% indépendante — vos données sont les vôtres

---

Créé par [Prouesse](https://prouesse.vc)
