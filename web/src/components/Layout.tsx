import type { ReactNode } from "react";
import { CreditsDisplay } from "./CreditsDisplay";
import { useAuth } from "../contexts/AuthContext";
import { APP_CONFIG } from "../config";

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
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      {/* Demo banner */}
      {user?.role === "demo" && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 text-center text-sm text-yellow-400">
          Mode démonstration — les emails ne sont pas envoyés et les données sont simulées
        </div>
      )}

      <header className="bg-[#161822] border-b border-white/5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <img src="https://prouesse.vc/logo-white.png" alt="Prouesse" className="h-8" />
              <div>
                <span className="text-base font-bold text-white tracking-tight">{APP_CONFIG.name}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <CreditsDisplay />
            {user && (
              <span className="text-xs text-gray-400">
                {user.nom || user.email}
                {user.role === "admin" && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-blue-500/15 text-blue-400 rounded text-[10px] font-medium">
                    Admin
                  </span>
                )}
                {user.role === "demo" && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded text-[10px] font-medium">
                    Demo
                  </span>
                )}
              </span>
            )}
            <button
              onClick={logout}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Déconnexion
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-0 -mb-px overflow-x-auto">
            {TABS.map((tab) => {
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className={`text-xs mr-1 ${activeTab === tab.id ? "text-blue-500" : "text-gray-600"}`}>
                    {tab.step}.
                  </span>
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6 flex-1">{children}</main>
      <footer className="border-t border-white/5 py-3 text-center text-xs text-gray-600">
        {APP_CONFIG.brandLine} &middot;{" "}
        <a href={`mailto:${APP_CONFIG.supportEmail}`} className="text-gray-500 hover:text-gray-400 transition-colors">
          Contact
        </a>
      </footer>
    </div>
  );
}
