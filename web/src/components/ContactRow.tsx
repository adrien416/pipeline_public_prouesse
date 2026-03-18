import { useState } from "react";
import type { ContactWithScoring } from "../types";
import { useUpdateContact } from "../hooks/useContacts";
import { GradeBadge, StatutBadge } from "./Badge";
import { EnrichButton } from "./EnrichButton";

interface Props {
  contact: ContactWithScoring;
}

const EDITABLE_FIELDS = [
  "nom", "prenom", "email", "entreprise", "titre", "domaine",
  "secteur", "telephone", "linkedin", "statut",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

export function ContactRow({ contact }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const update = useUpdateContact();

  function startEdit() {
    const d: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) d[f] = contact[f] ?? "";
    setDraft(d);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
  }

  function saveEdit() {
    // Only send changed fields
    const changes: Record<string, string> = { id: contact.id };
    let hasChanges = false;
    for (const f of EDITABLE_FIELDS) {
      if (draft[f] !== (contact[f] ?? "")) {
        changes[f] = draft[f];
        hasChanges = true;
      }
    }
    if (hasChanges) {
      update.mutate(changes as { id: string });
    }
    setEditing(false);
  }

  function updateField(field: EditableField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  if (editing) {
    return (
      <tr className="bg-blue-50/50">
        <td className="px-3 py-2">
          <GradeBadge grade={contact.grade} />
        </td>
        <td className="px-3 py-2">
          <input
            value={draft.prenom}
            onChange={(e) => updateField("prenom", e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Prénom"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={draft.nom}
            onChange={(e) => updateField("nom", e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Nom"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={draft.email}
            onChange={(e) => updateField("email", e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Email"
            type="email"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={draft.entreprise}
            onChange={(e) => updateField("entreprise", e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Entreprise"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={draft.titre}
            onChange={(e) => updateField("titre", e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Titre"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={draft.secteur}
            onChange={(e) => updateField("secteur", e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Secteur"
          />
        </td>
        <td className="px-3 py-2">
          <select
            value={draft.statut}
            onChange={(e) => updateField("statut", e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="nouveau">Nouveau</option>
            <option value="enrichi">Enrichi</option>
            <option value="contacte">Contacté</option>
            <option value="repondu">Répondu</option>
            <option value="exclu">Exclu</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              disabled={update.isPending}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 min-h-[36px]"
            >
              {update.isPending ? "..." : "OK"}
            </button>
            <button
              onClick={cancelEdit}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 min-h-[36px]"
            >
              Annuler
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50 border-b border-gray-100">
      <td className="px-3 py-3">
        <GradeBadge grade={contact.grade} />
      </td>
      <td className="px-3 py-3 text-sm font-medium text-gray-900">
        {contact.prenom}
      </td>
      <td className="px-3 py-3 text-sm font-medium text-gray-900">
        {contact.nom}
      </td>
      <td className="px-3 py-3 text-sm text-gray-600">
        {contact.email ? (
          <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline">
            {contact.email}
          </a>
        ) : (
          <span className="text-gray-400 italic">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-sm text-gray-700">{contact.entreprise}</td>
      <td className="px-3 py-3 text-sm text-gray-600">{contact.titre}</td>
      <td className="px-3 py-3 text-sm text-gray-600">{contact.secteur}</td>
      <td className="px-3 py-3">
        <StatutBadge statut={contact.statut} />
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-2 items-center">
          <button
            onClick={startEdit}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Modifier"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <EnrichButton contact={contact} />
        </div>
      </td>
    </tr>
  );
}
