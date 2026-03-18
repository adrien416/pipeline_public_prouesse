import { useState } from "react";
import { useCreateContact } from "../hooks/useContacts";

const EMPTY = {
  nom: "",
  prenom: "",
  email: "",
  entreprise: "",
  titre: "",
  domaine: "",
  secteur: "",
  linkedin: "",
  telephone: "",
};

export function ContactForm() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const create = useCreateContact();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nom && !form.prenom) return;
    create.mutate(form, {
      onSuccess: () => {
        setForm(EMPTY);
        setOpen(false);
      },
    });
  }

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium
          text-white bg-blue-600 rounded-lg hover:bg-blue-700 min-h-[44px]"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Ajouter un contact
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-gray-200 rounded-xl p-4 mb-4"
    >
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        Nouveau contact
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <input
          value={form.prenom}
          onChange={(e) => update("prenom", e.target.value)}
          placeholder="Prénom *"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
          required
        />
        <input
          value={form.nom}
          onChange={(e) => update("nom", e.target.value)}
          placeholder="Nom *"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
          required
        />
        <input
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="Email"
          type="email"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
        <input
          value={form.entreprise}
          onChange={(e) => update("entreprise", e.target.value)}
          placeholder="Entreprise"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
        <input
          value={form.titre}
          onChange={(e) => update("titre", e.target.value)}
          placeholder="Titre / Poste"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
        <input
          value={form.domaine}
          onChange={(e) => update("domaine", e.target.value)}
          placeholder="Domaine (site web)"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
        <input
          value={form.secteur}
          onChange={(e) => update("secteur", e.target.value)}
          placeholder="Secteur"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
        <input
          value={form.linkedin}
          onChange={(e) => update("linkedin", e.target.value)}
          placeholder="LinkedIn URL"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
        <input
          value={form.telephone}
          onChange={(e) => update("telephone", e.target.value)}
          placeholder="Téléphone"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
        />
      </div>
      <div className="flex gap-3 mt-4">
        <button
          type="submit"
          disabled={create.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
        >
          {create.isPending ? "Ajout..." : "Ajouter"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setForm(EMPTY);
          }}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 min-h-[44px]"
        >
          Annuler
        </button>
      </div>
      {create.isError && (
        <p className="text-sm text-red-600 mt-2">
          Erreur : {create.error.message}
        </p>
      )}
    </form>
  );
}
