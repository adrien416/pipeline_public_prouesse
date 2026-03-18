import { useQuery } from "@tanstack/react-query";
import type { Scoring } from "../types";

async function fetchScoring(contactId?: string): Promise<Scoring[]> {
  const params = contactId ? `?contact_id=${contactId}` : "";
  const res = await fetch(`/api/scoring${params}`);
  if (!res.ok) throw new Error("Erreur chargement scoring");
  const { scoring } = await res.json();
  return scoring;
}

export function useScoring(contactId?: string) {
  return useQuery({
    queryKey: ["scoring", contactId],
    queryFn: () => fetchScoring(contactId),
    enabled: !!contactId,
  });
}
