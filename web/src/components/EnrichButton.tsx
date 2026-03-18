import { useState } from "react";
import { useEnrich } from "../hooks/useEnrich";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./Spinner";
import type { ContactWithScoring } from "../types";

interface Props {
  contact: ContactWithScoring;
}

function validateContact(contact: ContactWithScoring): string | null {
  if (!contact.nom && !contact.prenom) {
    return "Nom ou prénom requis";
  }
  if (!contact.domaine && !contact.entreprise && !contact.linkedin) {
    return "Entreprise, domaine ou LinkedIn requis pour enrichir";
  }
  return null;
}

export function EnrichButton({ contact }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enrich = useEnrich();

  const isPending =
    contact.enrichissement_status === "pending" || enrich.isPending;
  const isOk = contact.enrichissement_status === "ok";
  const isError =
    contact.enrichissement_status === "erreur" || error !== null;

  if (isOk) return null;

  function handleClick() {
    setError(null);
    const validation = validateContact(contact);
    if (validation) {
      setError(validation);
      return;
    }
    setShowConfirm(true);
  }

  function handleEnrich() {
    setShowConfirm(false);
    setError(null);
    enrich.mutate(contact.id, {
      onError: (err) => {
        setError(err instanceof Error ? err.message : "Erreur d'enrichissement");
      },
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
          bg-purple-50 text-purple-700 hover:bg-purple-100
          disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
      >
        {isPending ? (
          <>
            <Spinner className="h-3.5 w-3.5" />
            En cours...
          </>
        ) : isError ? (
          "Réessayer"
        ) : (
          "Enrichir"
        )}
      </button>

      {error && (
        <span className="text-xs text-red-600 max-w-[180px]">{error}</span>
      )}

      {contact.enrichissement_status === "erreur" && !error && (
        <span className="text-xs text-red-600">Échec</span>
      )}

      {contact.enrichissement_status === "pas_de_resultat" && (
        <span className="text-xs text-orange-600">Pas de résultat</span>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="Enrichir ce contact ?"
        message={`Lancer l'enrichissement Fullenrich pour ${contact.prenom} ${contact.nom}${contact.entreprise ? ` (${contact.entreprise})` : ""} ? Cela consomme 1 credit.`}
        confirmLabel="Enrichir"
        onConfirm={handleEnrich}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
