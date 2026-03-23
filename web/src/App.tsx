import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Layout, type Tab } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { SearchPage } from "./pages/SearchPage";
import { ScoringPage } from "./pages/ScoringPage";
import { EnrichPage } from "./pages/EnrichPage";
import { CampaignPage } from "./pages/CampaignPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { Spinner } from "./components/Spinner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Maps each tab to its 0-based step index. */
const TAB_INDEX: Record<Tab, number> = {
  search: 0,
  scoring: 1,
  enrich: 2,
  campaign: 3,
  analytics: 4,
};

function loadSavedState() {
  try {
    const saved = localStorage.getItem("prouesse_session");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

function AppContent() {
  const { authenticated, loading } = useAuth();

  const saved = loadSavedState();
  const [tab, setTab] = useState<Tab>(saved?.tab || "search");
  const [rechercheId, setRechercheId] = useState<string | null>(saved?.rechercheId || null);
  const [searchMode, setSearchMode] = useState<"levee_de_fonds" | "cession">(saved?.searchMode || "levee_de_fonds");
  const [campaignId, setCampaignId] = useState<string | null>(saved?.campaignId || null);
  const [maxReachedStep, setMaxReachedStep] = useState<number>(saved?.maxReachedStep || 0);

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem("prouesse_session", JSON.stringify({
      tab, rechercheId, searchMode, campaignId, maxReachedStep,
    }));
  }, [tab, rechercheId, searchMode, campaignId, maxReachedStep]);

  /** Advance to a tab AND unlock it (and all previous tabs). */
  function goTo(target: Tab) {
    const idx = TAB_INDEX[target];
    setMaxReachedStep((prev) => Math.max(prev, idx));
    setTab(target);
  }

  /** Load a previous search (from search selector) */
  function loadRecherche(id: string, mode: "levee_de_fonds" | "cession", targetTab?: Tab) {
    setRechercheId(id);
    setSearchMode(mode);
    setCampaignId(null); // Reset so auto-select picks the right campaign
    setMaxReachedStep((prev) => Math.max(prev, 2)); // Unlock up to enrich
    if (targetTab) {
      const idx = TAB_INDEX[targetTab];
      setMaxReachedStep((prev) => Math.max(prev, idx));
      setTab(targetTab);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!authenticated) return <LoginPage />;

  return (
    <Layout activeTab={tab} onTabChange={setTab} maxReachedStep={maxReachedStep}>
      {tab === "search" && (
        <SearchPage
          onComplete={(id, mode) => {
            setRechercheId(id);
            setSearchMode(mode);
            goTo("scoring");
          }}
          onLoadRecherche={loadRecherche}
        />
      )}
      {tab === "scoring" && rechercheId && (
        <ScoringPage
          key={rechercheId}
          rechercheId={rechercheId}
          mode={searchMode}
          onComplete={() => goTo("enrich")}
          onBackToSearch={() => setTab("search")}
        />
      )}
      {tab === "scoring" && !rechercheId && (
        <EmptyState message="Lance d'abord une recherche" onAction={() => setTab("search")} />
      )}
      {tab === "enrich" && rechercheId && (
        <EnrichPage
          rechercheId={rechercheId}
          onComplete={() => goTo("campaign")}
          onViewCampaign={(cId) => {
            setCampaignId(cId);
            goTo("analytics");
          }}
        />
      )}
      {tab === "enrich" && !rechercheId && (
        <EmptyState message="Lance d'abord une recherche" onAction={() => setTab("search")} />
      )}
      {tab === "campaign" && rechercheId && (
        <CampaignPage
          rechercheId={rechercheId}
          mode={searchMode}
          onComplete={(cId) => {
            setCampaignId(cId);
            goTo("analytics");
          }}
          onNavigateToSearch={(id, m) => loadRecherche(id, m as "levee_de_fonds" | "cession", "campaign")}
        />
      )}
      {tab === "campaign" && !rechercheId && (
        <EmptyState message="Lance d'abord une recherche" onAction={() => setTab("search")} />
      )}
      {tab === "analytics" && <AnalyticsPage campaignId={campaignId || undefined} />}
    </Layout>
  );
}

function EmptyState({ message, onAction }: { message: string; onAction: () => void }) {
  return (
    <div className="text-center py-20">
      <p className="text-gray-500 mb-4">{message}</p>
      <button
        onClick={onAction}
        className="bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-blue-700"
      >
        Aller à la recherche
      </button>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
}
