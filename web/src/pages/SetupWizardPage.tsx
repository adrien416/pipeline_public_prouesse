import { useState, useCallback, useEffect } from "react";
import { APP_CONFIG } from "../config";
import { ApiKeyInput } from "../components/ApiKeyInput";
import { SetupProgress } from "../components/SetupProgress";
import { Spinner } from "../components/Spinner";
import { netlifyProxy } from "../api/client";

type StepStatus = "pending" | "testing" | "success" | "error";

interface StepState {
  status: StepStatus;
  message?: string;
}

interface Props {
  onComplete: () => void;
}

const STEPS = [
  { id: "netlify", label: "Connexion Netlify", icon: "1" },
  { id: "anthropic", label: "Clé Anthropic (Claude)", icon: "2" },
  { id: "fullenrich", label: "Clé Fullenrich", icon: "3" },
  { id: "brevo", label: "Clé Brevo + Email", icon: "4" },
  { id: "google", label: "Google Sheets", icon: "5" },
] as const;

export function SetupWizardPage({ onComplete }: Props) {
  const [activeStep, setActiveStep] = useState(0);
  const [steps, setSteps] = useState<Record<string, StepState>>({
    netlify: { status: "pending" },
    anthropic: { status: "pending" },
    fullenrich: { status: "pending" },
    brevo: { status: "pending" },
    google: { status: "pending" },
  });

  // Netlify connection
  const [netlifyToken, setNetlifyToken] = useState("");
  const [netlifySites, setNetlifySites] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");

  // API Keys
  const [anthropicKey, setAnthropicKey] = useState("");
  const [fullenrichKey, setFullenrichKey] = useState("");
  const [brevoKey, setBrevoKey] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");

  // Google
  const [googleKeyB64, setGoogleKeyB64] = useState("");
  const [sheetsId, setSheetsId] = useState("");

  // Injection state
  const [injecting, setInjecting] = useState(false);
  const [deployState, setDeployState] = useState<"idle" | "deploying" | "done" | "error">("idle");

  const updateStep = useCallback((id: string, state: StepState) => {
    setSteps((prev) => ({ ...prev, [id]: state }));
  }, []);

  // Auto-load Netlify credentials from InitialSetupPage if available
  useEffect(() => {
    const savedToken = localStorage.getItem("netlify_setup_token");
    const savedSiteId = localStorage.getItem("netlify_setup_site_id");
    if (savedToken && savedSiteId) {
      setNetlifyToken(savedToken);
      setSelectedSiteId(savedSiteId);
      updateStep("netlify", { status: "success", message: "Connecté via la configuration initiale" });
      setActiveStep(1);
      // Clean up sensitive token from localStorage
      localStorage.removeItem("netlify_setup_token");
      localStorage.removeItem("netlify_setup_site_id");
      // Fetch sites list in background for display
      fetch(`https://api.netlify.com/api/v1/sites?per_page=100`, {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then((r) => r.ok ? r.json() : [])
        .then((data) => {
          const siteList = (data as Array<Record<string, unknown>>).map((s) => ({
            id: s.id as string,
            name: s.name as string,
            url: (s.ssl_url || s.url) as string,
          }));
          setNetlifySites(siteList);
        })
        .catch(() => { /* ignore */ });
    }
  }, [updateStep]);

  const completedCount = Object.values(steps).filter((s) => s.status === "success").length;

  // ── Step 1: Connect Netlify ──
  async function connectNetlify() {
    if (!netlifyToken.trim()) {
      updateStep("netlify", { status: "error", message: "Collez votre Personal Access Token Netlify" });
      return;
    }
    updateStep("netlify", { status: "testing" });
    try {
      const resp = await netlifyProxy("list-sites", {}, netlifyToken);
      const sites = (resp as any).sites || [];
      if (sites.length === 0) {
        updateStep("netlify", { status: "error", message: "Aucun site trouvé sur ce compte. Déployez d'abord votre site via le bouton Deploy to Netlify." });
        return;
      }
      setNetlifySites(sites);
      // Auto-select if only one site
      if (sites.length === 1) {
        setSelectedSiteId(sites[0].id);
      }
      updateStep("netlify", { status: "success", message: `${sites.length} site(s) trouvé(s)` });
      setActiveStep(1);
    } catch {
      updateStep("netlify", { status: "error", message: "Token invalide ou erreur réseau. Vérifiez votre token." });
    }
  }

  function skipNetlify() {
    updateStep("netlify", { status: "success", message: "Configuration manuelle" });
    setActiveStep(1);
  }

  // ── Generic key injection ──
  async function injectEnvVar(key: string, value: string) {
    if (!netlifyToken || !selectedSiteId) return;
    try {
      await netlifyProxy("set-env-vars", {
        site_id: selectedSiteId,
        env_vars: { [key]: value },
      }, netlifyToken);
    } catch (err) {
      console.error(`Failed to inject ${key}:`, err);
    }
  }

  // ── Helper: test key via server-side proxy (avoids CORS) ──
  async function testKeyViaServer(service: string, key: string, senderEmail?: string): Promise<boolean> {
    const resp = await fetch("/api/test-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, key, sender_email: senderEmail }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.valid === true;
  }

  // ── Step 2: Anthropic ──
  async function testAnthropic() {
    if (!anthropicKey.trim()) {
      updateStep("anthropic", { status: "error", message: "Collez votre clé API Anthropic" });
      return;
    }
    updateStep("anthropic", { status: "testing" });
    try {
      const valid = await testKeyViaServer("anthropic", anthropicKey);
      if (valid) {
        updateStep("anthropic", { status: "success", message: "Connexion réussie" });
        await injectEnvVar("ANTHROPIC_API_KEY", anthropicKey);
        setActiveStep(2);
      } else {
        updateStep("anthropic", { status: "error", message: "Clé invalide. Vérifiez que vous avez copié la clé complète depuis console.anthropic.com." });
      }
    } catch {
      updateStep("anthropic", { status: "error", message: "Erreur réseau. Réessayez." });
    }
  }

  // ── Step 3: Fullenrich ──
  async function testFullenrich() {
    if (!fullenrichKey.trim()) {
      updateStep("fullenrich", { status: "error", message: "Collez votre clé API Fullenrich" });
      return;
    }
    updateStep("fullenrich", { status: "testing" });
    try {
      const valid = await testKeyViaServer("fullenrich", fullenrichKey);
      if (valid) {
        updateStep("fullenrich", { status: "success", message: "Connexion réussie" });
        await injectEnvVar("FULLENRICH_API_KEY", fullenrichKey);
        setActiveStep(3);
      } else {
        updateStep("fullenrich", { status: "error", message: "Clé invalide. Vérifiez sur fullenrich.com → Settings → API." });
      }
    } catch {
      updateStep("fullenrich", { status: "error", message: "Erreur réseau. Réessayez." });
    }
  }

  // ── Step 4: Brevo ──
  async function testBrevo() {
    if (!brevoKey.trim()) {
      updateStep("brevo", { status: "error", message: "Collez votre clé API Brevo" });
      return;
    }
    if (!senderEmail.trim()) {
      updateStep("brevo", { status: "error", message: "Entrez votre email d'expédition" });
      return;
    }
    updateStep("brevo", { status: "testing" });
    try {
      const valid = await testKeyViaServer("brevo", brevoKey, senderEmail);
      if (valid) {
        updateStep("brevo", { status: "success", message: "Connexion réussie" });
        if (selectedSiteId) {
          await netlifyProxy("set-env-vars", {
            site_id: selectedSiteId,
            env_vars: {
              BREVO_API_KEY: brevoKey,
              SENDER_EMAIL: senderEmail,
              SENDER_NAME: senderName || senderEmail.split("@")[0],
            },
          }, netlifyToken);
        }
        setActiveStep(4);
      } else {
        updateStep("brevo", { status: "error", message: "Clé invalide. Vérifiez sur app.brevo.com → Settings → SMTP & API." });
      }
    } catch {
      updateStep("brevo", { status: "error", message: "Erreur réseau. Réessayez." });
    }
  }

  // ── Step 5: Google Sheets ──
  function handleGoogleKeyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = btoa(reader.result as string);
      setGoogleKeyB64(b64);
    };
    reader.readAsText(file);
  }

  async function testGoogleSheets() {
    if (!googleKeyB64) {
      updateStep("google", { status: "error", message: "Uploadez votre fichier service-account.json" });
      return;
    }
    if (!sheetsId.trim()) {
      updateStep("google", { status: "error", message: "Entrez l'ID de votre Google Spreadsheet" });
      return;
    }
    updateStep("google", { status: "testing" });

    if (selectedSiteId) {
      try {
        await netlifyProxy("set-env-vars", {
          site_id: selectedSiteId,
          env_vars: {
            GOOGLE_SERVICE_ACCOUNT_KEY: googleKeyB64,
            GOOGLE_SHEETS_ID: sheetsId,
          },
        }, netlifyToken);
        updateStep("google", { status: "success", message: "Clés injectées. Le test se fera après redéploiement." });
      } catch {
        updateStep("google", { status: "error", message: "Erreur d'injection. Vérifiez votre connexion Netlify." });
        return;
      }
    } else {
      updateStep("google", { status: "success", message: "Configurez manuellement dans Netlify." });
    }
  }

  // ── Final: inject remaining vars + redeploy ──
  async function finalizeSetup() {
    if (!selectedSiteId) {
      onComplete();
      return;
    }

    setInjecting(true);
    try {
      // Trigger redeploy (JWT_SECRET already set during initial account creation)
      setDeployState("deploying");
      await netlifyProxy("redeploy", { site_id: selectedSiteId }, netlifyToken);

      // Poll deploy status
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const status = await netlifyProxy("deploy-status", { site_id: selectedSiteId }, netlifyToken);
          if ((status as any).state === "ready") {
            setDeployState("done");
            break;
          }
          if ((status as any).state === "error") {
            setDeployState("error");
            break;
          }
        } catch { /* keep polling */ }
      }
    } catch {
      setDeployState("error");
    }
    setInjecting(false);
  }

  const allDone = completedCount === STEPS.length;

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl">
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

        {/* Progress */}
        <div className="mb-6">
          <SetupProgress current={completedCount} total={STEPS.length} />
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {STEPS.map((step, idx) => {
            const state = steps[step.id];
            const isActive = idx === activeStep;
            const isCompleted = state.status === "success";

            return (
              <div
                key={step.id}
                className={`bg-[#161822] rounded-xl border transition-all ${
                  isActive ? "border-blue-500/50 shadow-lg shadow-blue-500/5" : isCompleted ? "border-green-500/30" : "border-white/5"
                }`}
              >
                {/* Step header */}
                <button
                  onClick={() => setActiveStep(idx)}
                  className="w-full px-4 py-3 flex items-center gap-3"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    isCompleted ? "bg-green-500/20 text-green-400" :
                    state.status === "error" ? "bg-red-500/20 text-red-400" :
                    isActive ? "bg-blue-500/20 text-blue-400" :
                    "bg-white/5 text-gray-500"
                  }`}>
                    {isCompleted ? "✓" : state.status === "testing" ? <Spinner className="h-4 w-4" /> : step.icon}
                  </div>
                  <div className="text-left flex-1">
                    <span className={`text-sm font-medium ${isCompleted ? "text-green-400" : isActive ? "text-white" : "text-gray-500"}`}>
                      {step.label}
                    </span>
                    {state.message && (
                      <p className={`text-xs ${state.status === "error" ? "text-red-400" : "text-gray-500"}`}>
                        {state.message}
                      </p>
                    )}
                  </div>
                </button>

                {/* Step content */}
                {isActive && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Step 1: Netlify */}
                    {step.id === "netlify" && (
                      <>
                        <p className="text-xs text-gray-400">
                          Connectez votre compte Netlify pour que l'app configure automatiquement vos clés API.
                        </p>
                        <p className="text-xs text-gray-500">
                          Créez un token sur{" "}
                          <a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                            app.netlify.com → User Settings → Applications → Personal Access Tokens
                          </a>
                        </p>
                        <ApiKeyInput value={netlifyToken} onChange={setNetlifyToken} placeholder="Collez votre Personal Access Token Netlify" />
                        {netlifySites.length > 0 && (
                          <div className="space-y-2">
                            <label className="text-xs text-gray-400">Sélectionnez votre site :</label>
                            <select
                              value={selectedSiteId}
                              onChange={(e) => setSelectedSiteId(e.target.value)}
                              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                            >
                              <option value="">Choisir un site...</option>
                              {netlifySites.map((site) => (
                                <option key={site.id} value={site.id}>{site.name} — {site.url}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={connectNetlify} className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700">
                            {netlifySites.length > 0 ? "Rafraîchir" : "Connecter"}
                          </button>
                          <button onClick={skipNetlify} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-2">
                            Configurer manuellement →
                          </button>
                        </div>
                      </>
                    )}

                    {/* Step 2: Anthropic */}
                    {step.id === "anthropic" && (
                      <>
                        <p className="text-xs text-gray-400">
                          <strong>A quoi &ccedil;a sert :</strong> Claude (l'IA d'Anthropic) est le cerveau de votre pipeline. Il recherche les entreprises correspondant &agrave; votre cible, score chaque contact par pertinence, et r&eacute;dige des emails personnalis&eacute;s.
                        </p>
                        <div className="bg-[#1a1d2e] rounded-lg p-3 text-xs text-gray-400 space-y-1">
                          <p className="font-medium text-gray-300">Comment obtenir votre cl&eacute; :</p>
                          <ol className="list-decimal list-inside space-y-1">
                            <li>Allez sur <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">console.anthropic.com</a> et cr&eacute;ez un compte</li>
                            <li>Ajoutez des cr&eacute;dits : <strong>Settings &rarr; Billing &rarr; Add credits</strong> (~5$ pour d&eacute;marrer)</li>
                            <li><strong>D&eacute;sactivez l'auto-recharge</strong> pour &eacute;viter les mauvaises surprises</li>
                            <li>Cr&eacute;ez votre cl&eacute; : <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Settings &rarr; API Keys &rarr; Create Key</a></li>
                            <li>Copiez la cl&eacute; (elle commence par <code className="text-gray-300">sk-ant-...</code>)</li>
                          </ol>
                        </div>
                        <ApiKeyInput value={anthropicKey} onChange={setAnthropicKey} placeholder="sk-ant-..." />
                        <button onClick={testAnthropic} className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700">
                          Tester la connexion
                        </button>
                      </>
                    )}

                    {/* Step 3: Fullenrich */}
                    {step.id === "fullenrich" && (
                      <>
                        <p className="text-xs text-gray-400">
                          <strong>A quoi &ccedil;a sert :</strong> Fullenrich trouve l'adresse email professionnelle de chaque contact &agrave; partir de son nom et de son entreprise. Sans email, pas de campagne.
                        </p>
                        <div className="bg-[#1a1d2e] rounded-lg p-3 text-xs text-gray-400 space-y-1">
                          <p className="font-medium text-gray-300">Comment obtenir votre cl&eacute; :</p>
                          <ol className="list-decimal list-inside space-y-1">
                            <li>Cr&eacute;ez un compte sur <a href="https://fullenrich.com?via=wDRTwS1HGWy5" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">fullenrich.com</a> (50 emails gratuits pour d&eacute;marrer)</li>
                            <li>Allez dans <a href="https://app.fullenrich.com/settings" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Settings &rarr; API</a></li>
                            <li>Copiez votre cl&eacute; API</li>
                          </ol>
                          <p className="text-gray-500 mt-1">Si vous avez besoin de plus de 50 emails, le pack "bulk" est recommand&eacute;.</p>
                        </div>
                        <ApiKeyInput value={fullenrichKey} onChange={setFullenrichKey} placeholder="Votre clé API Fullenrich" />
                        <button onClick={testFullenrich} className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700">
                          Tester la connexion
                        </button>
                      </>
                    )}

                    {/* Step 4: Brevo */}
                    {step.id === "brevo" && (
                      <>
                        <p className="text-xs text-gray-400">
                          <strong>A quoi &ccedil;a sert :</strong> Brevo est le service qui envoie vos emails de prospection. Il g&egrave;re aussi le suivi (ouvertures, clics, r&eacute;ponses). Gratuit jusqu'&agrave; 300 emails/jour.
                        </p>
                        <div className="bg-[#1a1d2e] rounded-lg p-3 text-xs text-gray-400 space-y-1">
                          <p className="font-medium text-gray-300">Comment obtenir votre cl&eacute; :</p>
                          <ol className="list-decimal list-inside space-y-1">
                            <li>Cr&eacute;ez un compte sur <a href="https://app.brevo.com/account/register" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">app.brevo.com</a></li>
                            <li>Allez dans <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Settings &rarr; SMTP & API &rarr; API Keys</a></li>
                            <li>Cliquez <strong>"Generate a new API key"</strong> &rarr; copiez-la (commence par <code className="text-gray-300">xkeysib-...</code>)</li>
                          </ol>
                        </div>
                        <ApiKeyInput value={brevoKey} onChange={setBrevoKey} placeholder="xkeysib-..." />
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">Email d'expédition</label>
                            <input
                              value={senderEmail}
                              onChange={(e) => setSenderEmail(e.target.value)}
                              placeholder="vous@votredomaine.com"
                              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">Nom d'expéditeur</label>
                            <input
                              value={senderName}
                              onChange={(e) => setSenderName(e.target.value)}
                              placeholder="Votre Prénom"
                              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                            />
                          </div>
                        </div>
                        <button onClick={testBrevo} className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700">
                          Tester la connexion
                        </button>
                      </>
                    )}

                    {/* Step 5: Google Sheets */}
                    {step.id === "google" && (
                      <>
                        <p className="text-xs text-gray-400">
                          <strong>A quoi &ccedil;a sert :</strong> Google Sheets est votre base de donn&eacute;es. Tous vos contacts, recherches et campagnes y sont stock&eacute;s. C'est gratuit.
                        </p>
                        <div className="bg-[#1a1d2e] rounded-lg p-3 text-xs text-gray-400 space-y-1.5">
                          <p className="font-medium text-gray-300">C'est l'&eacute;tape la plus longue (~5 min). Suivez bien chaque &eacute;tape :</p>
                          <ol className="list-decimal list-inside space-y-1.5">
                            <li>Allez sur <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">console.cloud.google.com</a> et connectez-vous avec votre compte Google</li>
                            <li>Cr&eacute;ez un <strong>nouveau projet</strong> (bouton en haut &rarr; "New Project" &rarr; donnez un nom &rarr; "Create")</li>
                            <li>Activez l'API : menu hamburger (3 barres) &rarr; <strong>"APIs & Services"</strong> &rarr; <strong>"Library"</strong> &rarr; cherchez <strong>"Google Sheets API"</strong> &rarr; <strong>"Enable"</strong></li>
                            <li>Cr&eacute;ez un Service Account : menu &rarr; <strong>"IAM & Admin"</strong> &rarr; <strong>"Service Accounts"</strong> &rarr; <strong>"Create Service Account"</strong> &rarr; donnez un nom &rarr; "Create and Continue" &rarr; "Done"</li>
                            <li>Cr&eacute;ez une cl&eacute; : cliquez sur le service account &rarr; onglet <strong>"Keys"</strong> &rarr; <strong>"Add Key"</strong> &rarr; <strong>"Create New Key"</strong> &rarr; <strong>JSON</strong> &rarr; "Create" (un fichier .json se t&eacute;l&eacute;charge)</li>
                            <li>Cr&eacute;ez un <a href="https://sheets.new" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">nouveau Google Sheet</a> &rarr; copiez l'ID depuis l'URL (entre <code className="text-gray-300">/d/</code> et <code className="text-gray-300">/edit</code>)</li>
                            <li><strong>Partagez le Sheet</strong> avec l'email du service account (il ressemble &agrave; <code className="text-gray-300">nom@projet.iam.gserviceaccount.com</code>) en tant qu'<strong>&Eacute;diteur</strong></li>
                          </ol>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Fichier service-account.json</label>
                          <input
                            type="file"
                            accept=".json"
                            onChange={handleGoogleKeyFile}
                            className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                          />
                          {googleKeyB64 && <p className="text-xs text-green-400 mt-1">Fichier chargé</p>}
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">ID du Google Spreadsheet</label>
                          <input
                            value={sheetsId}
                            onChange={(e) => setSheetsId(e.target.value)}
                            placeholder="Copiez l'ID depuis l'URL du Sheet (la partie entre /d/ et /edit)"
                            className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                          />
                        </div>
                        <button onClick={testGoogleSheets} className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-blue-700">
                          Enregistrer
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Finalize */}
        {allDone && (
          <div className="mt-6 bg-[#161822] rounded-xl border border-green-500/30 p-6 text-center space-y-4">
            <div className="text-2xl">🎉</div>
            <h3 className="text-lg font-bold text-white">Configuration terminée !</h3>
            {selectedSiteId ? (
              <>
                {deployState === "idle" && (
                  <button
                    onClick={finalizeSetup}
                    disabled={injecting}
                    className="bg-green-600 text-white font-medium rounded-lg px-6 py-3 text-sm hover:bg-green-700 disabled:opacity-50"
                  >
                    {injecting ? "Finalisation..." : "Redéployer et lancer le pipeline"}
                  </button>
                )}
                {deployState === "deploying" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-blue-400">
                    <Spinner className="h-4 w-4" />
                    Déploiement en cours... Cela peut prendre 1-2 minutes.
                  </div>
                )}
                {deployState === "done" && (
                  <div className="space-y-3">
                    <p className="text-sm text-green-400">Votre site est prêt !</p>
                    <button
                      onClick={onComplete}
                      className="bg-blue-600 text-white font-medium rounded-lg px-6 py-3 text-sm hover:bg-blue-700"
                    >
                      Accéder au pipeline
                    </button>
                  </div>
                )}
                {deployState === "error" && (
                  <div className="space-y-3">
                    <p className="text-sm text-red-400">Erreur de déploiement. Vérifiez votre configuration Netlify.</p>
                    <button onClick={onComplete} className="text-sm text-gray-400 hover:text-white">
                      Continuer quand même →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  Configurez les variables d'environnement manuellement dans Netlify, puis redéployez.
                </p>
                <button
                  onClick={onComplete}
                  className="bg-blue-600 text-white font-medium rounded-lg px-6 py-3 text-sm hover:bg-blue-700"
                >
                  Accéder au pipeline
                </button>
              </div>
            )}
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
