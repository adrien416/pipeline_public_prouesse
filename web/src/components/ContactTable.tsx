import { useState } from "react";
import { useContacts } from "../hooks/useContacts";
import type { ContactFilters } from "../types";
import { FilterBar } from "./FilterBar";
import { ContactRow } from "./ContactRow";
import { ContactForm } from "./ContactForm";
import { ExportCSVButton } from "./ExportCSVButton";
import { Spinner } from "./Spinner";

const COLUMNS = [
  "Grade",
  "Prénom",
  "Nom",
  "Email",
  "Entreprise",
  "Titre",
  "Secteur",
  "Statut",
  "Actions",
];

export function ContactTable() {
  const [filters, setFilters] = useState<ContactFilters>({});
  const { data: contacts, isLoading, isError, error } = useContacts(filters);

  return (
    <div className="flex flex-col h-full">
      <FilterBar filters={filters} onChange={setFilters} />

      <div className="px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
        <ContactForm />
        <ExportCSVButton contacts={contacts ?? []} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
          <span className="ml-3 text-sm text-gray-500">Chargement...</span>
        </div>
      )}

      {isError && (
        <div className="mx-4 p-4 bg-red-50 text-red-700 rounded-lg text-sm">
          Erreur : {error.message}
        </div>
      )}

      {contacts && contacts.length === 0 && !isLoading && (
        <div className="text-center py-12 text-gray-500 text-sm">
          Aucun contact trouvé.
          {(filters.grade || filters.statut || filters.secteur) && (
            <button
              onClick={() => setFilters({})}
              className="ml-2 text-blue-600 underline"
            >
              Effacer les filtres
            </button>
          )}
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div className="overflow-x-auto flex-1">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80">
                {COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {contacts && (
        <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-500">
          {contacts.length} contact{contacts.length > 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
