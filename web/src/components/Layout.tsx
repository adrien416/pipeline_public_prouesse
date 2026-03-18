import type { ReactNode } from "react";
import { CreditsDisplay } from "./CreditsDisplay";
import { useAuth } from "../contexts/AuthContext";

export type Tab = "search" | "scoring" | "enrich" | "campaign" | "analytics";

interface Props {
  children: ReactNode;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; step: string }[] = [
  { id: "search", label: "Recherche", step: "1" },
  { id: "scoring", label: "Scoring", step: "2" },
  { id: "enrich", label: "Enrichissement", step: "3" },
  { id: "campaign", label: "Campagne", step: "4" },
  { id: "analytics", label: "Analytics", step: "5" },
];

export function Layout({ children, activeTab, onTabChange }: Props) {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div>
            <span className="text-lg font-bold text-gray-900">Prouesse</span>
            <span className="text-xs text-gray-400 ml-2">Pipeline</span>
          </div>
          <div className="flex items-center gap-4">
            <CreditsDisplay />
            <button
              onClick={logout}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Deconnexion
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-0 -mb-px overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="text-xs text-gray-400 mr-1">{tab.step}.</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
