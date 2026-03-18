import type { ContactWithScoring } from "../types";

const CSV_COLUMNS: { key: keyof ContactWithScoring; label: string }[] = [
  { key: "nom", label: "Nom" },
  { key: "prenom", label: "Prénom" },
  { key: "email", label: "Email" },
  { key: "entreprise", label: "Entreprise" },
  { key: "titre", label: "Titre" },
  { key: "domaine", label: "Domaine" },
  { key: "secteur", label: "Secteur" },
  { key: "telephone", label: "Téléphone" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "statut", label: "Statut" },
  { key: "grade", label: "Grade" },
  { key: "score", label: "Score" },
];

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Génère un CSV et le télécharge dans le navigateur */
export function downloadCSV(contacts: ContactWithScoring[], filename?: string) {
  const header = CSV_COLUMNS.map((c) => c.label).join(",");
  const rows = contacts.map((contact) =>
    CSV_COLUMNS.map((c) => escapeCSV(String(contact[c.key] ?? ""))).join(",")
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `contacts_export_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}
