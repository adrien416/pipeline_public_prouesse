import { useState } from "react";
import bcrypt from "bcryptjs";
import { APP_CONFIG } from "../config";
import { ApiKeyInput } from "../components/ApiKeyInput";
import { Spinner } from "../components/Spinner";

const NETLIFY_API = "https://api.netlify.com/api/v1";
const FULLENRICH_REFERRAL = "https://fullenrich.com?via=wDRTwS1HGWy5";

interface Props {
  onComplete: () => void;
}

export function InitialSetupPage({ onComplete }: Props) {
  // Step management
  const [step, setStep] = useState<"netlify" | "account" | "deploying" | "done">("netlify");

  // Netlify
  const [netlifyToken, setNetlifyToken] = useState("");
  const [sites, setSites] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [netlifyError, setNetlifyError] = useState("");
  const [netlifyLoading, setNetlifyLoading] = useState(false);

  // Account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);

  // Deploy
  const [deployStatus, setDeployStatus] = useState("");
  const [deployError, setDeployError] = useState("");

  // ── Netlify connection ──
  async function connectNetlify() {
    if (!netlifyToken.trim()) {
      setNetlifyError("Collez votre Personal Access Token Netlify.");
      return;
    }
    setNetlifyError("");
    setNetlifyLoading(true);
    try {
      const resp = await fetch(`${NETLIFY_API}/sites?per_page=100`, {
        headers: { Authorization: `Bearer ${netlifyToken}` },
      });
      if (!resp.ok) {
        setNetlifyError("Token invalide ou erreur réseau. Vérifiez votre token.");
        setNetlifyLoading(false);
        return;
      }
      const data = await resp.json();
      const siteList = data.map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: s.name as string,
        url: (s.ssl_url || s.url) as string,
      }));
      if (siteList.length === 0) {
        setNetlifyError("Aucun site trouvé. Déployez d'abord via le bouton 'Deploy to Netlify'.");
        setNetlifyLoading(false);
        return;
      }
      setSites(siteList);
    } catch {
      setNetlifyError("Erreur réseau. Réessayez.");
    }
    setNetlifyLoading(false);
  }

  function goToAccount() {
    if (!selectedSiteId) {
      setNetlifyError("Sélectionnez votre site.");
      return;
    }
    // Save for SetupWizard later
    localStorage.setItem("netlify_setup_token", netlifyToken);
    localStorage.setItem("netlify_setup_site_id", selectedSiteId);
    setStep("account");
  }

  // ── Account creation ──
  async function createAccount() {
    setAccountError("");
    if (!email.trim()) {
      setAccountError("L'email est requis.");
      return;
    }
    if (password.length < 8) {
      setAccountError("Le mot de passe doit faire au moins 8 caractères.");
      return;
    }
    if (password !== passwordConfirm) {
      setAccountError("Les mots de passe ne correspondent pas.");
      return;
    }

    setAccountLoading(true);
    try {
      // Hash password
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(password, salt);

      // Generate JWT secret
      const jwtSecret = crypto.randomUUID() + "-" + crypto.randomUUID();

      // Inject env vars via Netlify API
      setDeployStatus("Configuration des variables d'environnement...");
      setStep("deploying");

      const envVars: Record<string, string> = {
        JWT_SECRET: jwtSecret,
        LOGIN_EMAIL: email,
        LOGIN_PASSWORD_HASH: hash,
        SENDER_EMAIL: email,
        SENDER_NAME: name || email.split("@")[0],
      };

      // Get existing env vars to know which to update vs create
      const existingResp = await fetch(
        `${NETLIFY_API}/accounts/me/env?site_id=${selectedSiteId}`,
        { headers: { Authorization: `Bearer ${netlifyToken}` } }
      );
      const existingVars: Array<{ key: string }> = existingResp.ok ? await existingResp.json() : [];
      const existingKeys = new Set(existingVars.map((v) => v.key));

      for (const [key, value] of Object.entries(envVars)) {
        if (existingKeys.has(key)) {
          await fetch(`${NETLIFY_API}/accounts/me/env/${key}?site_id=${selectedSiteId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${netlifyToken}` },
          });
        }
        const resp = await fetch(`${NETLIFY_API}/accounts/me/env?site_id=${selectedSiteId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${netlifyToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([{
            key,
            scopes: ["builds", "functions", "runtime", "post-processing"],
            values: [{ value, context: "all" }],
          }]),
        });
        if (!resp.ok) {
          throw new Error(`Erreur lors de la configuration de ${key}`);
        }
      }

      // Trigger redeploy
      setDeployStatus("Redéploiement en cours...");
      const deployResp = await fetch(`${NETLIFY_API}/sites/${selectedSiteId}/builds`, {
        method: "POST",
        headers: { Authorization: `Bearer ${netlifyToken}` },
      });
      if (!deployResp.ok) {
        throw new Error("Erreur de redéploiement. Vérifiez vos permissions Netlify.");
      }

      // Poll deploy status
      setDeployStatus("Déploiement en cours... Cela peut prendre 1-2 minutes.");
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const statusResp = await fetch(
            `${NETLIFY_API}/sites/${selectedSiteId}/deploys?per_page=1`,
            { headers: { Authorization: `Bearer ${netlifyToken}` } }
          );
          if (statusResp.ok) {
            const deploys = await statusResp.json();
            const latest = deploys[0];
            if (latest?.state === "ready") {
              setStep("done");
              return;
            }
            if (latest?.state === "error") {
              throw new Error("Le déploiement a échoué. Vérifiez les logs Netlify.");
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("échoué")) throw err;
        }
      }
      // Timeout
      setStep("done");
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Erreur inattendue.");
      setStep("deploying"); // Stay on deploying step to show error
    }
    setAccountLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <span className="text-white font-bold text-xl">{APP_CONFIG.logoLetter}</span>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white">{APP_CONFIG.name}</h1>
          <p className="text-sm text-gray-400 mt-1">Configurez votre pipeline en quelques minutes</p>
        </div>

        {/* Services info */}
        {step === "netlify" && sites.length === 0 && (
          <div className="bg-[#161822] rounded-xl border border-white/5 p-4 mb-6">
            <p className="text-xs text-gray-400 mb-2 font-medium">Services requis :</p>
            <ul className="text-xs text-gray-500 space-y-1.5">
              <li>
                <a href="https://app.netlify.com/signup" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Netlify</a> — H&eacute;bergement <span className="text-gray-600">(gratuit jusqu'&agrave; 100GB bande passante / 125K appels functions)</span>
              </li>
              <li>
                <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Anthropic</a> — IA (Claude) <span className="text-gray-600">(payant &mdash; cr&eacute;dits &agrave; recharger, ~5$ pour d&eacute;marrer)</span>
              </li>
              <li>
                <a href={FULLENRICH_REFERRAL} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Fullenrich</a> — Enrichissement email <span className="text-gray-600">(50 emails gratuits pour d&eacute;marrer)</span>
              </li>
              <li>
                <a href="https://app.brevo.com/account/register" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Brevo</a> — Envoi d'emails <span className="text-gray-600">(gratuit jusqu'&agrave; 300 emails/jour)</span>
              </li>
              <li>
                <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Cloud</a> — Base de donn&eacute;es (Sheets) <span className="text-gray-600">(gratuit)</span>
              </li>
            </ul>
          </div>
        )}

        {/* Step 1: Netlify */}
        {step === "netlify" && (
          <div className="bg-[#161822] rounded-xl border border-blue-500/30 shadow-lg shadow-blue-500/5 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-bold">1</div>
              <h2 className="text-white font-medium">Connexion Netlify</h2>
            </div>
            <p className="text-xs text-gray-400">
              Connectez votre compte Netlify pour que l'app configure automatiquement vos clés API.
            </p>
            <p className="text-xs text-gray-500">
              Créez un token sur{" "}
              <a
                href="https://app.netlify.com/user/applications#personal-access-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                app.netlify.com &rarr; User Settings &rarr; Personal Access Tokens
              </a>
            </p>
            <ApiKeyInput value={netlifyToken} onChange={setNetlifyToken} placeholder="Collez votre Personal Access Token Netlify" />

            {sites.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Sélectionnez votre site :</label>
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">Choisir un site...</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>{site.name} — {site.url}</option>
                  ))}
                </select>
              </div>
            )}

            {netlifyError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{netlifyError}</p>
            )}

            <div className="flex gap-2">
              {sites.length === 0 ? (
                <button
                  onClick={connectNetlify}
                  disabled={netlifyLoading}
                  className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
                >
                  {netlifyLoading ? <Spinner className="h-4 w-4" /> : "Connecter"}
                </button>
              ) : (
                <>
                  <button
                    onClick={goToAccount}
                    className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700"
                  >
                    Continuer
                  </button>
                  <button
                    onClick={connectNetlify}
                    disabled={netlifyLoading}
                    className="text-xs text-gray-500 hover:text-gray-300 px-3 py-2"
                  >
                    Rafraîchir la liste
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Account creation */}
        {step === "account" && (
          <div className="bg-[#161822] rounded-xl border border-blue-500/30 shadow-lg shadow-blue-500/5 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-bold">2</div>
              <h2 className="text-white font-medium">Créer votre compte administrateur</h2>
            </div>
            <p className="text-xs text-gray-400">
              Ces identifiants vous permettront de vous connecter à votre pipeline.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Votre nom</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Prénom Nom"
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Mot de passe * (8 caractères min.)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mot de passe"
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Confirmer le mot de passe *</label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Confirmez le mot de passe"
                  className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600"
                  required
                />
              </div>
            </div>

            {accountError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{accountError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={createAccount}
                disabled={accountLoading}
                className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
              >
                {accountLoading ? "Création..." : "Créer mon compte"}
              </button>
              <button
                onClick={() => setStep("netlify")}
                className="text-xs text-gray-500 hover:text-gray-300 px-3 py-2"
              >
                &larr; Retour
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Deploying */}
        {step === "deploying" && (
          <div className="bg-[#161822] rounded-xl border border-blue-500/30 p-6 text-center space-y-4">
            {!deployError ? (
              <>
                <Spinner className="h-8 w-8 mx-auto" />
                <p className="text-sm text-blue-400">{deployStatus}</p>
                <p className="text-xs text-gray-500">Ne fermez pas cette page.</p>
              </>
            ) : (
              <>
                <p className="text-sm text-red-400">{deployError}</p>
                <button
                  onClick={() => { setDeployError(""); setStep("account"); }}
                  className="text-sm text-gray-400 hover:text-white"
                >
                  &larr; Réessayer
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && (
          <div className="bg-[#161822] rounded-xl border border-green-500/30 p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <span className="text-green-400 text-2xl font-bold">&#10003;</span>
            </div>
            <h3 className="text-lg font-bold text-white">Compte créé avec succès !</h3>
            <p className="text-sm text-gray-400">
              Votre site a été redéployé. Vous pouvez maintenant vous connecter.
            </p>
            <button
              onClick={onComplete}
              className="bg-blue-600 text-white font-medium rounded-lg px-6 py-3 text-sm hover:bg-blue-700"
            >
              Se connecter
            </button>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-600 mt-6">
          {APP_CONFIG.brandLine} &middot;{" "}
          Besoin d'aide ?{" "}
          <a href={`mailto:${APP_CONFIG.supportEmail}`} className="text-gray-500 hover:text-gray-400">
            {APP_CONFIG.supportEmail}
          </a>
        </p>
      </div>
    </div>
  );
}
