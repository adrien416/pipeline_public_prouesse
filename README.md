# Prouesse Pipeline

**Pipeline de prospection B2B automatisé, propulsé par l'IA.**

Trouvez des contacts qualifiés, scorez-les automatiquement, enrichissez leurs emails, et envoyez des campagnes personnalisées — le tout depuis une seule interface.

Créé par [Prouesse](https://prouesse.vc).

---

## Temps total : ~15 minutes

## Ce dont vous avez besoin

Avant de commencer, créez des comptes sur ces services (tous ont des offres gratuites ou d'essai) :

| Service | Rôle | Lien |
|---------|------|------|
| **Netlify** | Héberge votre application | [Créer un compte](https://app.netlify.com/signup) |
| **Anthropic** | IA pour la recherche et le scoring | [Créer un compte](https://console.anthropic.com/) |
| **Fullenrich** | Trouve les emails professionnels | [Créer un compte](https://app.fullenrich.com/signup) |
| **Brevo** | Envoie vos emails de prospection | [Créer un compte](https://app.brevo.com/account/register) |
| **Google Cloud** | Stocke vos données (via Google Sheets) | [Créer un compte](https://console.cloud.google.com/) |

---

## Déployer en 1 clic

Cliquez sur le bouton ci-dessous pour déployer votre propre instance :

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/adrien416/pipeline_public)

> **Note** : Ce bouton crée une copie du code sur votre compte GitHub et la déploie automatiquement sur Netlify. Vous devrez ensuite configurer les clés API.

---

## Étape par étape

### Étape 1 : Déployer sur Netlify (2 min)

1. Cliquez sur le bouton "Deploy to Netlify" ci-dessus
2. Connectez-vous à votre compte Netlify (ou créez-en un)
3. Autorisez la connexion avec GitHub
4. Cliquez sur "Deploy"
5. Attendez que le déploiement se termine (~1 min)

### Étape 2 : Configurer dans l'application (10 min)

1. Ouvrez l'URL de votre site (ex: `https://votre-site.netlify.app`)
2. Connectez-vous avec l'email et le mot de passe que vous avez configurés
3. L'application vous guide automatiquement à travers la configuration :
   - **Connexion Netlify** : Collez votre Personal Access Token pour que l'app configure automatiquement vos clés
   - **Clé Anthropic** : Copiez-la depuis [console.anthropic.com → Settings → API Keys](https://console.anthropic.com/settings/keys)
   - **Clé Fullenrich** : Copiez-la depuis [fullenrich.com → Settings → API](https://app.fullenrich.com/settings)
   - **Clé Brevo** : Copiez-la depuis [app.brevo.com → Settings → SMTP & API](https://app.brevo.com/settings/keys/api)
   - **Google Sheets** : Suivez le guide dans l'app pour créer un service account et un spreadsheet

### Étape 3 : Lancer votre première recherche (3 min)

1. Décrivez votre cible (ex: "Fondateurs de startups cleantech en France")
2. Lancez la recherche — l'IA trouve les contacts correspondants
3. Scorez les contacts automatiquement
4. Enrichissez les emails des contacts qualifiés
5. Créez et envoyez votre première campagne

---

## Configuration manuelle (alternative)

Si vous préférez configurer manuellement, ajoutez ces variables d'environnement dans Netlify :

**Netlify → Site → Configuration → Environment Variables**

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Clé API Anthropic (commence par `sk-ant-`) |
| `FULLENRICH_API_KEY` | Clé API Fullenrich |
| `BREVO_API_KEY` | Clé API Brevo (commence par `xkeysib-`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Contenu du fichier service-account.json encodé en base64 |
| `GOOGLE_SHEETS_ID` | L'ID du Google Spreadsheet (dans l'URL, entre `/d/` et `/edit`) |
| `JWT_SECRET` | Un secret aléatoire (générez-le avec le script ci-dessous) |
| `LOGIN_EMAIL` | Votre email de connexion |
| `LOGIN_PASSWORD_HASH` | Hash bcrypt de votre mot de passe (générez-le avec le script ci-dessous) |
| `SENDER_EMAIL` | L'email qui apparaît comme expéditeur |
| `SENDER_NAME` | Le nom qui apparaît comme expéditeur |

### Générer les secrets

Utilisez le script `setup.sh` fourni :

```bash
./setup.sh
```

Ou manuellement :

```bash
# Générer JWT_SECRET
openssl rand -hex 32

# Générer LOGIN_PASSWORD_HASH (remplacez "votremotdepasse")
npx bcryptjs hash "votremotdepasse"

# Encoder la clé Google en base64
base64 -w 0 < service-account.json
```

---

## Si vous êtes bloqué

| Problème | Solution |
|----------|----------|
| "Non authentifié" après connexion | Vérifiez que `JWT_SECRET`, `LOGIN_EMAIL` et `LOGIN_PASSWORD_HASH` sont configurés dans les variables d'environnement Netlify |
| "GOOGLE_SERVICE_ACCOUNT_KEY non définie" | Ajoutez la clé du service account encodée en base64 dans les variables d'environnement |
| "ANTHROPIC_API_KEY non définie" | Ajoutez votre clé API Anthropic dans les variables d'environnement |
| Erreur de connexion Google Sheets | Vérifiez que le service account a accès au spreadsheet (partagé en éditeur) |
| Emails non envoyés | Vérifiez que `BREVO_API_KEY` est configurée et que votre domaine d'expédition est validé dans Brevo |
| "Erreur 500" | Vérifiez les logs de votre fonction dans Netlify → Functions → Logs |

---

## Sécurité

- Vos clés API sont stockées en tant que variables d'environnement Netlify (chiffrées)
- Aucun secret n'est stocké dans le code source
- L'authentification utilise JWT avec tokens HttpOnly
- Les mots de passe sont hashés avec bcrypt

---

## Support

Besoin d'aide ? Contactez-nous :

📧 **adrien@prouesse.vc**

---

Créé par [Prouesse](https://prouesse.vc)
