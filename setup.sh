#!/bin/bash
# setup.sh — Script d'aide pour générer les secrets nécessaires
# Créé par Prouesse (https://prouesse.vc)

echo "==================================="
echo "  Prouesse Pipeline — Setup Helper"
echo "==================================="
echo ""

# 1. Generate JWT Secret
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64)
echo "✅ JWT_SECRET généré :"
echo "   $JWT_SECRET"
echo ""

# 2. Generate password hash
echo "Entrez votre mot de passe admin :"
read -s PASSWORD
echo ""

if command -v npx &> /dev/null; then
  HASH=$(npx -y bcryptjs hash "$PASSWORD" 2>/dev/null)
  echo "✅ LOGIN_PASSWORD_HASH :"
  echo "   $HASH"
else
  echo "⚠️  npx non trouvé. Installez Node.js puis relancez ce script."
  echo "   Ou générez le hash manuellement : npx bcryptjs hash \"votremotdepasse\""
fi
echo ""

# 3. Encode Google key
echo "Chemin vers votre fichier service-account.json (laissez vide pour passer) :"
read KEY_PATH
if [ -n "$KEY_PATH" ] && [ -f "$KEY_PATH" ]; then
  B64=$(base64 -w 0 "$KEY_PATH" 2>/dev/null || base64 "$KEY_PATH" 2>/dev/null)
  echo "✅ GOOGLE_SERVICE_ACCOUNT_KEY :"
  echo "   ${B64:0:50}...${B64: -20}"
  echo ""
  echo "   (Valeur complète copiée dans le presse-papiers si disponible)"
  echo "$B64" | pbcopy 2>/dev/null || echo "$B64" | xclip -selection clipboard 2>/dev/null || true
else
  echo "⏭️  Passé. Vous pourrez l'ajouter plus tard."
fi

echo ""
echo "==================================="
echo "  Récapitulatif — Variables d'environnement Netlify"
echo "==================================="
echo ""
echo "JWT_SECRET=$JWT_SECRET"
echo "LOGIN_EMAIL=<votre_email>"
[ -n "$HASH" ] && echo "LOGIN_PASSWORD_HASH=$HASH"
[ -n "$B64" ] && echo "GOOGLE_SERVICE_ACCOUNT_KEY=$B64"
echo ""
echo "Ajoutez ces valeurs dans Netlify → Site → Configuration → Environment Variables"
echo ""
echo "Support : adrien@prouesse.vc"
