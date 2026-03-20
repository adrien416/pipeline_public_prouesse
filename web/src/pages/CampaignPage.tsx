import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchContacts, createCampaign, updateCampaign, fetchCampaign, fetchCampaigns, triggerSend, generatePhrases } from "../api/client";

function useDebouncedSave(campaignId: string | null, field: string, value: string, delay = 1500) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
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
  { id: "lun", label: "Lundi" },
  { id: "mar", label: "Mardi" },
  { id: "mer", label: "Mercredi" },
  { id: "jeu", label: "Jeudi" },
  { id: "ven", label: "Vendredi" },
  { id: "sam", label: "Samedi" },
  { id: "dim", label: "Dimanche" },
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
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0, errors: [] as string[] });

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

  // Load template from saved campaign
  useEffect(() => {
    if (campaignData && !templateLoaded) {
      if (campaignData.template_sujet) setSujet(campaignData.template_sujet);
      if (campaignData.template_corps) setCorps(campaignData.template_corps);
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
  });

  const toggleStatus = useMutation({
    mutationFn: () =>
      updateCampaign({
        id: campaignId,
        status: campaignStatus === "active" ? "paused" : "active",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign"] }),
  });

  async function doSendAll() {
    if (!campaignId || sending) return;
    setSending(true);
    const total = parseInt(campaignData?.total_leads || "0") - parseInt(campaignData?.sent || "0");
    setSendProgress({ sent: 0, total, errors: [] });
    try {
      let remaining = total;
      let sentCount = 0;
      while (remaining > 0) {
        const r = await triggerSend(campaignId);
        if (r.sent > 0) {
          sentCount += r.sent;
          setSendProgress((p) => ({ ...p, sent: sentCount }));
        }
        remaining = r.remaining ?? 0;
        setSendProgress((p) => ({ ...p, total: sentCount + remaining }));
        if (r.skipped_domain) {
          setSendProgress((p) => ({ ...p, errors: [...p.errors, `Doublon: ${r.skipped_domain}`] }));
        }
        if (r.sent === 0 && !r.skipped_domain) {
          // Daily limit reached or error — stop
          if (r.error) {
            setSendProgress((p) => ({ ...p, errors: [...p.errors, r.error!] }));
          }
          break;
        }
        // Wait interval between sends (minimum 5s to avoid hammering)
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    } catch (err) {
      setSendProgress((p) => ({ ...p, errors: [...p.errors, String(err)] }));
    } finally {
      setSending(false);
    }
  }

  function toggleDay(day: string) {
    setJours((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function previewEmail(contact: Record<string, string>) {
    return corps
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "")
      .replace(/\{Phrase\}/g, contact.phrase_perso || "[Phrase personnalisee IA]");
  }

  const estimatedDays = contactsList.length > 0
    ? Math.ceil(contactsList.length / (parseInt(maxParJour) || 15))
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">4. Campagne email</h2>
        <p className="text-sm text-gray-500 mt-1">
          {contactsList.length} contacts avec email a contacter
        </p>
      </div>

      {/* Existing campaigns for this search */}
      {campaignsList.length > 0 && !campaignId && (
        <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
          <h3 className="font-semibold text-sm text-gray-700">
            Campagnes existantes ({campaignsList.length})
          </h3>
          <div className="space-y-2">
            {campaignsList.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      c.status === "active" ? "bg-green-500" : "bg-orange-500"
                    }`}
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">{c.nom}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {c.sent || 0}/{c.total_leads || 0} envoyes
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onComplete(c.id)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Voir analytics →
                </button>
              </div>
            ))}
          </div>
          <div className="border-t pt-3">
            <p className="text-xs text-gray-500">
              Ou creer une nouvelle campagne ci-dessous
            </p>
          </div>
        </div>
      )}

      {/* Campaign status banner */}
      {campaignData && (
        <div
          className={`rounded-lg px-4 py-3 space-y-3 ${
            campaignStatus === "active"
              ? "bg-green-50 border border-green-200"
              : campaignStatus === "paused"
              ? "bg-orange-50 border border-orange-200"
              : "bg-gray-50 border border-gray-200"
          }`}
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  campaignStatus === "active" ? "bg-green-500" : "bg-orange-500"
                }`}
              />
              <span className="text-sm font-medium">
                {campaignData.nom || (campaignStatus === "active" ? "Campagne active" : "Campagne en pause")}
              </span>
              <span className="text-xs text-gray-500">
                {campaignData.sent || 0}/{campaignData.total_leads || 0} envoyes
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleStatus.mutate()}
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
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                >
                  {sending ? `Envoi ${sendProgress.sent}/${sendProgress.total}...` : "Envoyer maintenant"}
                </button>
              )}
              <button
                onClick={() => onComplete(campaignId!)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Analytics
              </button>
            </div>
          </div>

          {/* Send progress */}
          {sending && (
            <div className="flex items-center gap-3">
              <Spinner className="h-4 w-4 text-blue-600" />
              <div className="flex-1">
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Envoi en cours...</span>
                  <span>{sendProgress.sent}/{sendProgress.total}</span>
                </div>
                <div className="w-full bg-white rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${sendProgress.total > 0 ? (sendProgress.sent / sendProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Send errors */}
          {sendProgress.errors.length > 0 && !sending && (
            <div className="text-xs text-amber-700">
              {sendProgress.errors.map((e, i) => <div key={i}>{e}</div>)}
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

      {/* Campaign name */}
      {!campaignId && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <label className="block text-xs text-gray-500 mb-1">Nom de la campagne</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Ex: Fondateurs EdTech - Mars 2026"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
      )}

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
          <div className="text-xs text-gray-400">
            Variables : {"{Prenom}"}, {"{Entreprise}"}, {"{Phrase}"}
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

      {/* Schedule settings */}
      <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Parametres d'envoi</h3>

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
            <label className="block text-xs text-gray-500 mb-1">Intervalle min (min)</label>
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

        {!campaignId && (
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
        )}

        {create.isError && (
          <div className="text-sm text-red-600">
            {create.error instanceof Error ? create.error.message : "Erreur"}
          </div>
        )}
      </div>
    </div>
  );
}
