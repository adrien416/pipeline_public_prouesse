import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchContacts, createCampaign, updateCampaign, fetchCampaign, fetchCampaigns, triggerSend, generatePhrases, sendTestEmail, purgeAllCampaigns, deleteCampaign, rewriteTemplate } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";

function useDebouncedSave(campaignId: string | null, field: string, value: string, delay = 1500) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef(value);

  useEffect(() => {
    if (!campaignId || value === lastSaved.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      updateCampaign({ id: campaignId, [field]: value });
      lastSaved.current = value;
    }, delay);
    return () => clearTimeout(timer.current);
  }, [campaignId, field, value, delay]);

  // Reset lastSaved when campaignId changes
  useEffect(() => {
    lastSaved.current = value;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);
}
import { Spinner } from "../components/Spinner";

interface Props {
  rechercheId: string;
  mode: "levee_de_fonds" | "cession";
  onComplete: (campaignId: string) => void;
}

const DEFAULT_TEMPLATE = `Bonjour {Prenom},

{Phrase}

Chez Prouesse, nous accompagnons les fondateurs comme toi a vendre leur entreprise ou a acceder a des investisseurs qualifies (fonds, family offices, impact investors). Tu trouveras nos references sur notre site.

Est-ce que tu serais dispo pour un echange de 15 min cette semaine ?

Objectif : comprendre tes objectifs et evaluer le fit avec notre reseau.

Bien a toi,
Adrien`;

const DAYS = [
  { id: "lun", label: "Lun" },
  { id: "mar", label: "Mar" },
  { id: "mer", label: "Mer" },
  { id: "jeu", label: "Jeu" },
  { id: "ven", label: "Ven" },
  { id: "sam", label: "Sam" },
  { id: "dim", label: "Dim" },
];

export function CampaignPage({ rechercheId, mode, onComplete }: Props) {
  const qc = useQueryClient();
  const [nom, setNom] = useState("");
  const [sujet, setSujet] = useState("{Entreprise} — echange sur votre developpement");
  const [corps, setCorps] = useState(DEFAULT_TEMPLATE);
  const [maxParJour, setMaxParJour] = useState("15");
  const [jours, setJours] = useState(["lun", "mar", "mer", "jeu", "ven"]);
  const [heureDebut, setHeureDebut] = useState("08:30");
  const [heureFin, setHeureFin] = useState("18:30");
  const [intervalle, setIntervalle] = useState("20");
  const [selectedContact, setSelectedContact] = useState<Record<string, string> | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    count: number;
    domains: string[];
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0, errors: [] as string[], done: false });
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [rewriting, setRewriting] = useState(false);

  const contacts = useQuery({
    queryKey: ["contacts", rechercheId],
    queryFn: () => fetchContacts(rechercheId),
    select: (data) => data.contacts.filter((c) => c.email && parseInt(c.score_total) >= 7),
  });

  const existingCampaigns = useQuery({
    queryKey: ["campaigns", rechercheId],
    queryFn: () => fetchCampaigns(rechercheId),
  });

  const campaign = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => fetchCampaign(campaignId!),
    enabled: !!campaignId,
    refetchInterval: 5000,
  });

  const [generatingPhrases, setGeneratingPhrases] = useState(false);
  const [phraseProgress, setPhraseProgress] = useState({ generated: 0, total: 0 });
  const [templateLoaded, setTemplateLoaded] = useState(false);

  const contactsList = contacts.data || [];
  const campaignData = campaign.data?.campaign;
  const campaignStatus = campaignData?.status || "draft";
  const campaignsList = existingCampaigns.data?.campaigns || [];

  // Derive active and past campaigns
  const activeCampaign = campaignsList.find(
    (c) => c.status === "active" || c.status === "paused"
  );
  const pastCampaigns = campaignsList.filter(
    (c) => c.status === "cancelled" || c.status === "completed"
  );
  const hasActiveCampaign = !!activeCampaign;

  // Auto-select the active campaign
  useEffect(() => {
    if (activeCampaign && !campaignId) {
      setCampaignId(activeCampaign.id);
    }
  }, [activeCampaign, campaignId]);

  // Load template + params from saved campaign
  useEffect(() => {
    if (campaignData && !templateLoaded) {
      if (campaignData.template_sujet) setSujet(campaignData.template_sujet);
      if (campaignData.template_corps) setCorps(campaignData.template_corps);
      if (campaignData.max_par_jour) setMaxParJour(campaignData.max_par_jour);
      if (campaignData.heure_debut) setHeureDebut(campaignData.heure_debut);
      if (campaignData.heure_fin) setHeureFin(campaignData.heure_fin);
      if (campaignData.intervalle_min) setIntervalle(campaignData.intervalle_min);
      if (campaignData.jours_semaine) {
        try {
          const parsed = JSON.parse(campaignData.jours_semaine);
          if (Array.isArray(parsed)) setJours(parsed);
        } catch { /* keep default */ }
      }
      setTemplateLoaded(true);
    }
  }, [campaignData, templateLoaded]);

  // Reset templateLoaded when campaign changes
  useEffect(() => {
    setTemplateLoaded(false);
  }, [campaignId]);

  // Auto-save template changes
  useDebouncedSave(campaignId, "template_sujet", sujet);
  useDebouncedSave(campaignId, "template_corps", corps);

  // Auto-save send params (only when paused)
  const joursJson = JSON.stringify(jours);
  useDebouncedSave(campaignStatus === "paused" ? campaignId : null, "max_par_jour", maxParJour);
  useDebouncedSave(campaignStatus === "paused" ? campaignId : null, "heure_debut", heureDebut);
  useDebouncedSave(campaignStatus === "paused" ? campaignId : null, "heure_fin", heureFin);
  useDebouncedSave(campaignStatus === "paused" ? campaignId : null, "intervalle_min", intervalle);
  useDebouncedSave(campaignStatus === "paused" ? campaignId : null, "jours_semaine", joursJson);

  // Count contacts missing phrase_perso
  const missingPhrases = contactsList.filter((c) => !c.phrase_perso).length;

  useEffect(() => {
    if (contactsList.length > 0 && !selectedContact) {
      setSelectedContact(contactsList[0]);
    }
  }, [contactsList, selectedContact]);

  // Auto-generate phrases when contacts are loaded
  useEffect(() => {
    if (contactsList.length > 0 && missingPhrases > 0 && !generatingPhrases) {
      doGeneratePhrases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactsList.length, missingPhrases]);

  async function doGeneratePhrases() {
    setGeneratingPhrases(true);
    try {
      let done = false;
      while (!done) {
        const r = await generatePhrases(rechercheId, mode);
        setPhraseProgress({ generated: r.total - (r.remaining ?? 0), total: r.total });
        done = r.done;
        if (r.contacts?.length) {
          const prev = qc.getQueryData<{ contacts: Record<string, string>[] }>(["contacts", rechercheId]);
          if (prev) {
            const updatedIds = new Set(r.contacts.map((c) => c.id));
            const merged = prev.contacts.map((c) => {
              if (updatedIds.has(c.id)) return r.contacts.find((e) => e.id === c.id) || c;
              return c;
            });
            qc.setQueryData(["contacts", rechercheId], { contacts: merged });
          }
        }
        if (!done) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      qc.invalidateQueries({ queryKey: ["contacts"] });
    } catch (err) {
      console.error("Phrase generation error:", err);
    } finally {
      setGeneratingPhrases(false);
    }
  }

  const create = useMutation({
    mutationFn: () =>
      createCampaign({
        nom: nom || undefined,
        recherche_id: rechercheId,
        template_sujet: sujet,
        template_corps: corps,
        mode,
        max_par_jour: parseInt(maxParJour) || 15,
        jours_semaine: jours,
        heure_debut: heureDebut,
        heure_fin: heureFin,
        intervalle_min: parseInt(intervalle) || 20,
      }),
    onSuccess: (data) => {
      if (data.campaign?.id) setCampaignId(data.campaign.id);
      if (data.duplicates_excluded && data.duplicates_excluded > 0) {
        setDuplicateWarning({
          count: data.duplicates_excluded,
          domains: data.duplicate_domains || [],
        });
      }
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (error: any) => {
      // On 409 conflict, an active campaign already exists — refetch to pick it up
      if (error?.status === 409 && error?.body?.existing_campaign_id) {
        setCampaignId(error.body.existing_campaign_id);
        qc.invalidateQueries({ queryKey: ["campaigns"] });
      }
    },
  });

  const toggleStatus = useMutation({
    mutationFn: (targetId?: string) => {
      const id = targetId || campaignId;
      const camp = targetId
        ? campaignsList.find((c) => c.id === targetId)
        : campaignData;
      const currentStatus = camp?.status || "draft";
      return updateCampaign({
        id,
        status: currentStatus === "active" ? "paused" : "active",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const cancelCampaign = useMutation({
    mutationFn: (targetId: string) =>
      updateCampaign({ id: targetId, status: "cancelled" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      if (cancelConfirm === campaignId) {
        setCampaignId(null);
      }
      setCancelConfirm(null);
    },
  });

  async function doSendAll() {
    if (!campaignId || sending) return;
    setSending(true);
    const total = Math.max(0, parseInt(campaignData?.total_leads || "0") - parseInt(campaignData?.sent || "0"));
    setSendProgress({ sent: 0, total, errors: [], done: false });
    try {
      let remaining = total;
      let sentCount = 0;
      while (remaining > 0) {
        let r: { sent: number; remaining?: number; error?: string; skipped_domain?: string };
        try {
          r = await triggerSend(campaignId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setSendProgress((p) => ({ ...p, errors: [...p.errors, msg], done: true }));
          break;
        }
        if (r.sent > 0) {
          sentCount += r.sent;
          setSendProgress((p) => ({ ...p, sent: sentCount }));
          qc.invalidateQueries({ queryKey: ["campaign"] });
        }
        remaining = r.remaining ?? 0;
        setSendProgress((p) => ({ ...p, total: sentCount + remaining }));
        if (r.skipped_domain) {
          setSendProgress((p) => ({ ...p, errors: [...p.errors, `Doublon: ${r.skipped_domain}`] }));
        }
        if (r.sent === 0 && !r.skipped_domain) {
          if (r.error) {
            setSendProgress((p) => ({ ...p, errors: [...p.errors, r.error!] }));
          }
          break;
        }
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
      setSendProgress((p) => ({ ...p, done: true }));
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    } catch (err) {
      setSendProgress((p) => ({ ...p, errors: [...p.errors, String(err)], done: true }));
    } finally {
      setSending(false);
    }
  }

  async function doSendTest() {
    if (!campaignId || !testEmail || testSending) return;
    setTestSending(true);
    setTestResult(null);
    setTestError(null);
    try {
      const r = await sendTestEmail(campaignId, testEmail);
      if (r.sent) {
        setTestResult(`Email de test envoye a ${r.test_email} (contact: ${r.contact_used})`);
      } else {
        setTestError(r.error || "Erreur inconnue");
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestSending(false);
    }
  }

  const purge = useMutation({
    mutationFn: () => purgeAllCampaigns(),
    onSuccess: () => {
      setCampaignId(null);
      setPurgeConfirm(false);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["campaigns-all"] });
    },
  });

  const deleteCamp = useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["campaigns-all"] });
    },
  });

  function toggleDay(day: string) {
    setJours((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function previewEmail(contact: Record<string, string>) {
    const text = corps
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "")
      .replace(/\{Phrase\}/g, contact.phrase_perso || "[Phrase personnalisee IA]");
    // Split text on URLs and return React nodes with clickable links
    const urlRegex = /(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      const url = match[0];
      const href = url.startsWith("http") ? url : `https://${url}`;
      parts.push(
        <a key={match.index} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
          {url}
        </a>
      );
      lastIndex = urlRegex.lastIndex;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  }

  const estimatedDays = contactsList.length > 0
    ? Math.ceil(contactsList.length / (parseInt(maxParJour) || 15))
    : 0;

  const sentCount = parseInt(campaignData?.sent || "0");
  const totalLeads = parseInt(campaignData?.total_leads || "0");
  const campaignProgress = totalLeads > 0 ? Math.min(100, Math.round((sentCount / totalLeads) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">4. Campagne email</h2>
        <p className="text-sm text-gray-500 mt-1">
          {contactsList.length} contacts avec email a contacter
        </p>
      </div>

      {/* ─── ACTIVE CAMPAIGN VIEW ─── */}
      {campaignData && (
        <div className="space-y-4">
          {/* Campaign header card */}
          <div
            className={`rounded-xl border p-4 space-y-4 ${
              campaignStatus === "active"
                ? "bg-green-50 border-green-200"
                : campaignStatus === "cancelled"
                ? "bg-red-50 border-red-200"
                : campaignStatus === "paused"
                ? "bg-orange-50 border-orange-200"
                : campaignStatus === "completed"
                ? "bg-gray-50 border-gray-200"
                : "bg-gray-50 border-gray-200"
            }`}
          >
            {/* Top row: name + status + actions */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                      campaignStatus === "active"
                        ? "bg-green-500 animate-pulse"
                        : campaignStatus === "cancelled"
                        ? "bg-red-400"
                        : campaignStatus === "completed"
                        ? "bg-gray-400"
                        : "bg-orange-500"
                    }`}
                  />
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    campaignStatus === "active"
                      ? "bg-green-100 text-green-700"
                      : campaignStatus === "paused"
                      ? "bg-orange-100 text-orange-700"
                      : campaignStatus === "cancelled"
                      ? "bg-red-100 text-red-600"
                      : campaignStatus === "completed"
                      ? "bg-gray-100 text-gray-600"
                      : "bg-gray-100 text-gray-600"
                  }`}>
                    {campaignStatus === "active" ? "Active"
                      : campaignStatus === "paused" ? "En pause"
                      : campaignStatus === "cancelled" ? "Annulee"
                      : campaignStatus === "completed" ? "Terminee"
                      : "Brouillon"}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-gray-900 truncate">
                  {campaignData.nom || "Campagne sans nom"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Creee le {(() => {
                    if (!campaignData.date_creation) return "—";
                    const d = new Date(campaignData.date_creation);
                    return d.getFullYear() > 2000 ? d.toLocaleDateString("fr-FR") : "—";
                  })()}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {campaignStatus !== "cancelled" && (
                  <>
                    <button
                      onClick={() => toggleStatus.mutate(undefined)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                        campaignStatus === "active"
                          ? "bg-orange-100 text-orange-700 hover:bg-orange-200"
                          : "bg-green-100 text-green-700 hover:bg-green-200"
                      }`}
                    >
                      {campaignStatus === "active" ? "Pause" : "Reprendre"}
                    </button>
                    {campaignStatus === "active" && (
                      <button
                        onClick={doSendAll}
                        disabled={sending}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {sending ? `Envoi ${sendProgress.sent}/${sendProgress.total}...` : "Envoyer maintenant"}
                      </button>
                    )}
                    <button
                      onClick={() => setCancelConfirm(campaignId!)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      Annuler
                    </button>
                  </>
                )}
                <button
                  onClick={() => onComplete(campaignId!)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Analytics
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{sentCount} / {totalLeads} emails envoyes</span>
                <span>{campaignProgress}%</span>
              </div>
              <div className="w-full bg-white/60 rounded-full h-2.5">
                <div
                  className="bg-green-500 h-2.5 rounded-full transition-all"
                  style={{ width: `${campaignProgress}%` }}
                />
              </div>
            </div>

            {/* Send progress — visible during and after sending */}
            {(sending || sendProgress.done) && (
              <div className="space-y-2 border-t border-green-200/50 pt-3">
                <div className="flex items-center gap-3">
                  {sending && <Spinner className="h-4 w-4 text-blue-600" />}
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>
                        {sending
                          ? "Envoi en cours..."
                          : sendProgress.errors.length > 0 && sendProgress.sent === 0
                          ? "Echec de l'envoi"
                          : sendProgress.errors.length > 0
                          ? `Envoi arrete — ${sendProgress.sent} email${sendProgress.sent > 1 ? "s" : ""} envoye${sendProgress.sent > 1 ? "s" : ""}`
                          : `Termine — ${sendProgress.sent} email${sendProgress.sent > 1 ? "s" : ""} envoye${sendProgress.sent > 1 ? "s" : ""}`}
                      </span>
                      <span>{sendProgress.sent}/{sendProgress.total}</span>
                    </div>
                    <div className="w-full bg-white rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          !sending && sendProgress.errors.length > 0 && sendProgress.sent === 0
                            ? "bg-red-400"
                            : !sending && sendProgress.sent > 0
                            ? "bg-green-500"
                            : "bg-blue-500"
                        }`}
                        style={{ width: `${sendProgress.total > 0 ? (sendProgress.sent / sendProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {sendProgress.errors.length > 0 && (
                  <div className="bg-red-50 rounded-lg px-3 py-2 text-xs text-red-700 space-y-0.5">
                    {sendProgress.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Test email */}
          {campaignStatus === "active" && (
            <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Tester avant d'envoyer</h3>
              <div className="flex gap-2">
                <input
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="ton@email.com"
                  type="email"
                  className="flex-1 border rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={doSendTest}
                  disabled={testSending || !testEmail}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 shrink-0"
                >
                  {testSending ? "Envoi..." : "Envoyer un test"}
                </button>
              </div>
              {testResult && (
                <div className="bg-green-50 rounded-lg px-3 py-2 text-xs text-green-700">{testResult}</div>
              )}
              {testError && (
                <div className="bg-red-50 rounded-lg px-3 py-2 text-xs text-red-700">{testError}</div>
              )}
              <p className="text-xs text-gray-400">
                Envoie l'email avec les variables du premier contact, mais a ton adresse. Objet prefixe [TEST]. Aucun compteur modifie.
              </p>
            </div>
          )}

          {/* Schedule — editable when paused, read-only otherwise */}
          {campaignStatus !== "cancelled" && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">Parametres d'envoi</h3>
                {campaignStatus === "paused" && (
                  <span className="text-xs text-amber-600 font-medium">Modifiable en pause</span>
                )}
              </div>
              {campaignStatus === "paused" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Max emails/jour</label>
                      <input
                        type="number"
                        value={maxParJour}
                        onChange={(e) => setMaxParJour(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Heure debut</label>
                      <input
                        type="time"
                        value={heureDebut}
                        onChange={(e) => setHeureDebut(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Heure fin</label>
                      <input
                        type="time"
                        value={heureFin}
                        onChange={(e) => setHeureFin(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Intervalle (min)</label>
                      <input
                        type="number"
                        value={intervalle}
                        onChange={(e) => setIntervalle(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">Jours d'envoi</label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => toggleDay(d.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                            jours.includes(d.id)
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div><span className="text-gray-400">Max/jour :</span> {campaignData.max_par_jour || "15"}</div>
                  <div><span className="text-gray-400">Horaires :</span> {campaignData.heure_debut || "08:30"} – {campaignData.heure_fin || "18:30"}</div>
                  <div><span className="text-gray-400">Intervalle :</span> {campaignData.intervalle_min || "20"} min</div>
                  <div><span className="text-gray-400">Jours :</span> {(() => {
                      try {
                        const d = JSON.parse(campaignData.jours_semaine || "[]");
                        return Array.isArray(d) ? d.join(", ") : campaignData.jours_semaine;
                      } catch { return campaignData.jours_semaine; }
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Duplicate warning */}
      {duplicateWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <strong>{duplicateWarning.count} contact{duplicateWarning.count > 1 ? "s" : ""} exclu{duplicateWarning.count > 1 ? "s" : ""}</strong> car leur entreprise
          a deja ete contactee dans une campagne precedente.
          {duplicateWarning.domains.length > 0 && (
            <div className="text-xs mt-1 text-amber-600">
              Domaines : {[...new Set(duplicateWarning.domains)].slice(0, 10).join(", ")}
              {duplicateWarning.domains.length > 10 && ` (+${duplicateWarning.domains.length - 10})`}
            </div>
          )}
        </div>
      )}

      {/* Phrase generation progress */}
      {generatingPhrases && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <Spinner className="h-4 w-4 text-purple-600" />
          <span className="text-sm text-purple-700">
            Generation des phrases personnalisees IA... ({phraseProgress.generated}/{phraseProgress.total})
          </span>
        </div>
      )}

      {/* ─── TEMPLATE EDITOR + CONTACTS + PREVIEW ─── */}
      {/* Show when campaign is active/paused OR when creating new */}
      {(campaignData && campaignStatus !== "cancelled") || !hasActiveCampaign ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Template editor (left) */}
            <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
              <h3 className="font-semibold text-sm text-gray-700">Template email</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Objet</label>
                <input
                  value={sujet}
                  onChange={(e) => setSujet(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Corps</label>
                <textarea
                  value={corps}
                  onChange={(e) => setCorps(e.target.value)}
                  rows={14}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-400">
                  Variables : {"{Prenom}"}, {"{Entreprise}"}, {"{Phrase}"}
                </div>
                <button
                  onClick={async () => {
                    setRewriting(true);
                    try {
                      const result = await rewriteTemplate(rechercheId, mode, sujet, corps);
                      setSujet(result.sujet);
                      setCorps(result.corps);
                    } catch (err) {
                      console.error("Rewrite error:", err);
                    } finally {
                      setRewriting(false);
                    }
                  }}
                  disabled={rewriting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
                >
                  {rewriting ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      IA en cours...
                    </>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Ameliorer avec l'IA
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Contact list (center) */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="p-3 border-b bg-gray-50">
                <h3 className="font-semibold text-sm text-gray-700">
                  Leads ({contactsList.length})
                </h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                {contactsList.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedContact(c)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-gray-50 hover:bg-blue-50 flex items-center gap-2 ${
                      selectedContact?.id === c.id ? "bg-blue-50" : ""
                    }`}
                  >
                    <span className="text-xs text-gray-400 w-5">{i + 1}</span>
                    <span className="truncate text-gray-700">{c.email}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview (right) */}
            <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-gray-700">Preview</h3>
                {selectedContact && (
                  <span className="text-xs text-gray-400">
                    {selectedContact.prenom} {selectedContact.nom}
                  </span>
                )}
              </div>
              {selectedContact && (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Objet :</div>
                    <div className="text-sm font-medium">
                      {sujet
                        .replace(/\{Entreprise\}/g, selectedContact.entreprise || "")
                        .replace(/\{Prenom\}/g, selectedContact.prenom || "")}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Corps :</div>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                      {previewEmail(selectedContact)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── CREATION FORM (only when no active campaign) ─── */}
          {!hasActiveCampaign && !campaignId && (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
              <h3 className="font-semibold text-gray-900">Nouvelle campagne</h3>

              {/* Campaign name */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nom de la campagne (optionnel)</label>
                <input
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder="Ex: Fondateurs EdTech - Mars 2026"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {estimatedDays > 0 && (
                <div className="text-sm text-blue-600 font-medium">
                  Duree estimee de la campagne : {estimatedDays} jours
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Max emails/jour</label>
                  <input
                    type="number"
                    value={maxParJour}
                    onChange={(e) => setMaxParJour(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Heure debut</label>
                  <input
                    type="time"
                    value={heureDebut}
                    onChange={(e) => setHeureDebut(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Heure fin</label>
                  <input
                    type="time"
                    value={heureFin}
                    onChange={(e) => setHeureFin(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Intervalle (min)</label>
                  <input
                    type="number"
                    value={intervalle}
                    onChange={(e) => setIntervalle(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-2">Jours d'envoi</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => toggleDay(d.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                        jours.includes(d.id)
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 rounded-lg px-4 py-2 text-xs text-blue-700">
                Au maximum {maxParJour} emails envoyes par jour depuis adrien@prouesse.vc
              </div>

              <button
                onClick={() => create.mutate()}
                disabled={create.isPending || contactsList.length === 0}
                className="w-full bg-blue-600 text-white font-medium rounded-lg px-4 py-3 text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {create.isPending ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Creation de la campagne...
                  </>
                ) : (
                  `Lancer la campagne (${contactsList.length} contacts)`
                )}
              </button>

              {create.isError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {create.error instanceof Error ? create.error.message : "Erreur"}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}

      {/* ─── PAST CAMPAIGNS (collapsed) ─── */}
      {pastCampaigns.length > 0 && (
        <details className="bg-white rounded-xl shadow-sm border">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-600 hover:bg-gray-50 select-none">
            Campagnes precedentes ({pastCampaigns.length})
          </summary>
          <div className="px-4 pb-4 space-y-2 border-t pt-3">
            <div className="flex justify-end mb-1">
              <button
                onClick={() => setPurgeConfirm(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
              >
                Tout supprimer
              </button>
            </div>
            {pastCampaigns.map((c) => (
              <div
                key={c.id}
                className="bg-gray-50 rounded-lg px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${
                      c.status === "cancelled" ? "bg-red-400" : "bg-gray-400"
                    }`} />
                    <span className="text-sm font-medium text-gray-700 truncate">
                      {c.nom || "Sans nom"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {c.sent || 0}/{c.total_leads || 0} envoyes
                    {c.status === "cancelled" && " · Annulee"}
                    {c.status === "completed" && " · Terminee"}
                    {c.date_creation && new Date(c.date_creation).getFullYear() > 2000 && ` · ${new Date(c.date_creation).toLocaleDateString("fr-FR")}`}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => deleteCamp.mutate(c.id)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <ConfirmDialog
        open={!!cancelConfirm}
        title="Annuler la campagne"
        message="Les emails non envoyes ne seront pas envoyes. Les contacts seront liberes et pourront etre reassignes a une nouvelle campagne. Les emails deja envoyes ne sont pas affectes."
        confirmLabel="Annuler la campagne"
        variant="danger"
        onConfirm={() => cancelConfirm && cancelCampaign.mutate(cancelConfirm)}
        onCancel={() => setCancelConfirm(null)}
      />

      <ConfirmDialog
        open={purgeConfirm}
        title="Supprimer toutes les campagnes"
        message="Toutes les campagnes (actives, en pause, annulees) seront definitivement supprimees. Les contacts seront liberes. Les emails deja envoyes ne sont pas affectes."
        confirmLabel="Tout supprimer"
        variant="danger"
        onConfirm={() => purge.mutate()}
        onCancel={() => setPurgeConfirm(false)}
      />
    </div>
  );
}
