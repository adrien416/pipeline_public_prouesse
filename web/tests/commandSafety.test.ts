import { describe, expect, it } from "vitest";
import { isWriteLikeRequest } from "../netlify/lib/commandSafety";

describe("isWriteLikeRequest", () => {
  it.each([
    "Pourquoi ma campagne n’envoie pas ?",
    "Pourquoi l’envoi ne démarre pas ?",
    "Pourquoi l’envoi ne se lance pas ?",
    "Pourquoi la campagne est en pause ?",
    "Pourquoi la campagne est-elle active ?",
  ])("allows read-only campaign diagnostics: %s", (command: string) => {
    expect(isWriteLikeRequest(command)).toBe(false);
  });

  it.each([
    "Envoie la campagne",
    "Peux-tu envoyer la campagne ?",
    "Relance la campagne",
    "Lance l’enrichissement",
    "Confirme l’envoi",
    "Ne lance pas la campagne",
    "N’envoie pas cette campagne",
    "Mettre la campagne en pause",
    "Rendre la campagne active",
  ])("blocks action requests: %s", (command: string) => {
    expect(isWriteLikeRequest(command)).toBe(true);
  });

  it.each([
    "Pourquoi ma campagne n’envoie pas ? Envoie-la.",
    "Pourquoi la campagne est en pause ? Active-la.",
    "Pourquoi ma campagne n’envoie pas ? N’envoie pas cette campagne.",
    "Pourquoi l’envoi ne démarre pas ? Ne lance pas la campagne.",
  ])("keeps fail-closed behavior for mixed diagnostic/action requests: %s", (command: string) => {
    expect(isWriteLikeRequest(command)).toBe(true);
  });
});
