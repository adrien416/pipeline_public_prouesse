import { describe, expect, it } from "vitest";
import { isWriteLikeRequest } from "../netlify/functions/_commandSafety";

describe("isWriteLikeRequest", () => {
  it.each([
    "Pourquoi ma campagne n’envoie pas ?",
    "Pourquoi l’envoi ne démarre pas ?",
    "Pourquoi l’envoi ne se lance pas ?",
    "Pourquoi la campagne est en pause ?",
    "Pourquoi la campagne est active ?",
  ])("allows read-only campaign diagnostics: %s", (command: string) => {
    expect(isWriteLikeRequest(command)).toBe(false);
  });

  it.each([
    "Envoie la campagne",
    "Peux-tu envoyer la campagne ?",
    "Lance l’enrichissement",
    "Confirme l’envoi",
    "Ne lance pas la campagne",
  ])("blocks action requests: %s", (command: string) => {
    expect(isWriteLikeRequest(command)).toBe(true);
  });

  it("keeps fail-closed behavior for a diagnostic followed by an action", () => {
    expect(isWriteLikeRequest("Pourquoi ma campagne n’envoie pas ? Envoie-la.")).toBe(true);
    expect(isWriteLikeRequest("Pourquoi la campagne est en pause ? Active-la.")).toBe(true);
  });
});
