import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCampaigns,
  fetchContacts,
  getEnrichEstimate,
  interpretCommand,
} from "../api/client";
import { diagnoseCampaign, selectContacts } from "../lib/commandTools";
import type { Campagne, Contact } from "../types";

type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "message"; title: string; lines: string[]; tone?: "neutral" | "warning" }
  | { kind: "contacts"; title: string; contacts: Contact[] };

interface CommandPaletteProps {
  rechercheId: string | null;
  campaignId: string | null;
}

const EXAMPLES = [
  "Sélectionne les contacts avec un score au moins 7 et un email",
  "Prévisualise le coût d’enrichissement",
  "Pourquoi ma campagne ne part pas ?",
];

function asContacts(rows: Array<Record<string, string>>): Contact[] {
  return rows as Contact[];
}

function asCampaigns(rows: Array<Record<string, string>>): Campagne[] {
  return rows as Campagne[];
}

export function CommandPalette({ rechercheId, campaignId }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<ResultState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setResult({ kind: "idle" });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const contextLabel = useMemo(() => {
    if (!rechercheId) return "Aucune recherche sélectionnée";
    return campaignId ? "Recherche et campagne actives" : "Recherche active";
  }, [rechercheId, campaignId]);

  async function run(rawCommand?: string) {
    const value = (rawCommand ?? command).trim();
    if (!value) return;
    setCommand(value);
    setResult({ kind: "loading" });

    try {
      const { intent } = await interpretCommand(value);

      if (intent.tool === "unsupported") {
        setResult({
          kind: "message",
          title: "Action volontairement indisponible",
          tone: "warning",
          lines: [
            intent.reason || "Cette commande sort du périmètre read-only du POC.",
            "L’assistant ne peut ni envoyer, ni enrichir, ni modifier, ni confirmer une action.",
          ],
        });
        return;
      }

      if (!rechercheId) {
        setResult({
          kind: "message",
          title: "Sélectionne d’abord une recherche",
          lines: ["Ces commandes s’exécutent uniquement sur la recherche courante."],
        });
        return;
      }

      if (intent.tool === "select_contacts") {
        const response = await fetchContacts(rechercheId);
        const contacts = selectContacts(asContacts(response.contacts), intent.args);
        setResult({
          kind: "contacts",
          title: `${contacts.length} contact(s) correspondent`,
          contacts,
        });
        return;
      }

      if (intent.tool === "preview_enrichment") {
        const estimate = await getEnrichEstimate(rechercheId);
        const enough = estimate.current_balance >= estimate.estimated_credits;
        setResult({
          kind: "message",
          title: "Prévisualisation uniquement",
          tone: enough ? "neutral" : "warning",
          lines: [
            `${estimate.contacts_to_enrich} contact(s) à enrichir.`,
            `Coût estimé : ${estimate.estimated_credits} crédit(s).`,
            `Solde actuel : ${estimate.current_balance} crédit(s).`,
            enough ? "Le solde semble suffisant." : "Le solde semble insuffisant.",
            "Aucun enrichissement n’a été lancé.",
          ],
        });
        return;
      }

      const [campaignResponse, contactsResponse] = await Promise.all([
        fetchCampaigns(rechercheId, true),
        fetchContacts(rechercheId),
      ]);
      const diagnostic = diagnoseCampaign(
        asCampaigns(campaignResponse.campaigns),
        asContacts(contactsResponse.contacts),
        campaignId,
      );
      setResult({
        kind: "message",
        title: diagnostic.campaignName
          ? `Diagnostic : ${diagnostic.campaignName}`
          : "Diagnostic campagne",
        tone: diagnostic.blockers.length ? "warning" : "neutral",
        lines: [
          ...diagnostic.blockers.map((line) => `Blocage : ${line}`),
          ...diagnostic.warnings.map((line) => `À vérifier : ${line}`),
          ...diagnostic.facts,
          "Aucune campagne n’a été modifiée et aucun envoi n’a été déclenché.",
        ],
      });
    } catch (error) {
      setResult({
        kind: "message",
        title: "Commande impossible",
        tone: "warning",
        lines: [error instanceof Error ? error.message : "Erreur inconnue"],
      });
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 text-xs font-medium text-gray-700 shadow-sm backdrop-blur hover:bg-gray-50"
        aria-label="Ouvrir les commandes"
      >
        Commandes <span className="ml-1 text-gray-400">⌘K</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Commandes</p>
              <p className="text-xs text-gray-500">{contextLabel} · lecture seule</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-gray-700">Esc</button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <input
              ref={inputRef}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Ex. sélectionne les contacts avec un score au moins 7"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:bg-white"
            />
          </form>
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-5">
          {result.kind === "idle" && (
            <div className="space-y-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void run(example)}
                  className="block w-full rounded-xl border border-gray-100 px-4 py-3 text-left text-sm text-gray-700 hover:border-gray-200 hover:bg-gray-50"
                >
                  {example}
                </button>
              ))}
              <p className="pt-2 text-xs leading-5 text-gray-400">
                Ce POC ne dispose d’aucun outil d’écriture. L’envoi d’emails et le lancement d’un enrichissement restent exclusivement dans l’interface normale.
              </p>
            </div>
          )}

          {result.kind === "loading" && (
            <div className="py-8 text-center text-sm text-gray-500">Analyse de la commande…</div>
          )}

          {result.kind === "message" && (
            <div className={result.tone === "warning" ? "rounded-xl border border-amber-200 bg-amber-50 p-4" : "rounded-xl border border-gray-200 bg-gray-50 p-4"}>
              <p className="mb-3 text-sm font-semibold text-gray-900">{result.title}</p>
              <ul className="space-y-2 text-sm text-gray-700">
                {result.lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
              </ul>
            </div>
          )}

          {result.kind === "contacts" && (
            <div>
              <p className="mb-3 text-sm font-semibold text-gray-900">{result.title}</p>
              {result.contacts.length === 0 ? (
                <p className="text-sm text-gray-500">Aucun contact ne correspond à ces critères.</p>
              ) : (
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {result.contacts.slice(0, 30).map((contact) => (
                    <div key={contact.id} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{contact.prenom} {contact.nom}</p>
                        <p className="truncate text-xs text-gray-500">{contact.titre || "Titre non renseigné"} · {contact.entreprise || "Entreprise non renseignée"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-medium text-gray-700">Score {contact.score_total || "—"}</p>
                        <p className="text-[11px] text-gray-400">{contact.email ? "email connu" : "sans email"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {result.contacts.length > 30 && <p className="mt-2 text-xs text-gray-400">30 premiers affichés.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
