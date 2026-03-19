import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchContacts, createCampaign, updateCampaign, fetchCampaign, triggerSend } from "../api/client";
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
  const [sujet, setSujet] = useState("{Entreprise} — echange sur votre developpement");
  const [corps, setCorps] = useState(DEFAULT_TEMPLATE);
  const [maxParJour, setMaxParJour] = useState("15");
  const [jours, setJours] = useState(["lun", "mar", "mer", "jeu", "ven"]);
  const [heureDebut, setHeureDebut] = useState("08:30");
  const [heureFin, setHeureFin] = useState("18:30");
  const [intervalle, setIntervalle] = useState("20");
  const [selectedContact, setSelectedContact] = useState<Record<string, string> | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const contacts = useQuery({
    queryKey: ["contacts", rechercheId],
    queryFn: () => fetchContacts(rechercheId),
    select: (data) => data.contacts.filter((c) => c.email && parseInt(c.score_total) >= 7),
  });

  const campaign = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => fetchCampaign(campaignId!),
    enabled: !!campaignId,
    refetchInterval: 5000,
  });

  const contactsList = contacts.data || [];
  const campaignData = campaign.data?.campaign;
  const campaignStatus = campaignData?.status || "draft";

  useEffect(() => {
    if (contactsList.length > 0 && !selectedContact) {
      setSelectedContact(contactsList[0]);
    }
  }, [contactsList, selectedContact]);

  const create = useMutation({
    mutationFn: () =>
      createCampaign({
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

  const send = useMutation({
    mutationFn: () => triggerSend(campaignId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign"] }),
  });

  function toggleDay(day: string) {
    setJours((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function previewEmail(contact: Record<string, string>) {
    let preview = corps
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "")
      .replace(/\{Phrase\}/g, contact.phrase_perso || "[Phrase personnalisee IA]");
    return preview;
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

      {/* Campaign status banner */}
      {campaignData && (
        <div
          className={`rounded-lg px-4 py-3 flex items-center justify-between ${
            campaignStatus === "active"
              ? "bg-green-50 border border-green-200"
              : campaignStatus === "paused"
              ? "bg-orange-50 border border-orange-200"
              : "bg-gray-50 border border-gray-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                campaignStatus === "active" ? "bg-green-500" : "bg-orange-500"
              }`}
            />
            <span className="text-sm font-medium">
              {campaignStatus === "active" ? "Campagne active" : "Campagne en pause"}
            </span>
            <span className="text-xs text-gray-500">
              {campaignData.sent || 0}/{campaignData.total_leads || 0} envoyes
            </span>
          </div>
          <div className="flex gap-2">
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
                onClick={() => send.mutate()}
                disabled={send.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              >
                {send.isPending ? "Envoi..." : "Envoyer maintenant"}
              </button>
            )}
            <button
              onClick={() => onComplete(campaignId!)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              Analytics →
            </button>
          </div>
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
