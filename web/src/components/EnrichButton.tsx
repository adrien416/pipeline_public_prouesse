import { useState } from "react";
import { useEnrich } from "../hooks/useEnrich";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./Spinner";
import type { ContactWithScoring } from "../types";

interface Props {
  contact: ContactWithScoring;
}

export function EnrichButton({ contact }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const enrich = useEnrich();

  const isPending =
    contact.enrichissement_status === "pending" || enrich.isPending;
  const isOk = contact.enrichissement_status === "ok";

  if (isOk) return null;

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
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
        ) : (
          "Enrichir"
        )}
      </button>

      <ConfirmDialog
        open={showConfirm}
        title="Enrichir ce contact ?"
        message={`Lancer l'enrichissement Fullenrich pour ${contact.prenom} ${contact.nom} (${contact.entreprise}) ? Cela consomme 1 credit.`}
        confirmLabel="Enrichir"
        onConfirm={() => {
          setShowConfirm(false);
          enrich.mutate(contact.id);
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
