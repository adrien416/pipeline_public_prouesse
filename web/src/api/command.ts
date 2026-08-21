import type { ContactSelection } from "../lib/commandTools";

export type CommandIntent =
  | { tool: "select_contacts"; args: ContactSelection }
  | { tool: "preview_enrichment"; args: Record<string, never> }
  | { tool: "diagnose_campaign"; args: Record<string, never> }
  | { tool: "unsupported"; args: Record<string, never>; reason?: string };

export async function interpretCommand(command: string): Promise<{
  intent: CommandIntent;
  interpreted_by: string;
}> {
  const response = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });

  if (response.status === 401) {
    window.location.reload();
    throw new Error("Non authentifié");
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Erreur ${response.status}`);
  return body;
}
