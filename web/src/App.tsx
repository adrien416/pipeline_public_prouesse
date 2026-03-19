import { useState } from "react";
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

function AppContent() {
  const { authenticated, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("search");
  const [rechercheId, setRechercheId] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"levee_de_fonds" | "cession">("levee_de_fonds");
  const [campaignId, setCampaignId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!authenticated) return <LoginPage />;

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === "search" && (
        <SearchPage
          onComplete={(id, mode) => {
            setRechercheId(id);
            setSearchMode(mode);
            setTab("scoring");
          }}
        />
      )}
      {tab === "scoring" && rechercheId && (
        <ScoringPage
          rechercheId={rechercheId}
          mode={searchMode}
          onComplete={() => setTab("enrich")}
        />
      )}
      {tab === "scoring" && !rechercheId && (
        <EmptyState message="Lance d'abord une recherche" onAction={() => setTab("search")} />
      )}
      {tab === "enrich" && rechercheId && (
        <EnrichPage rechercheId={rechercheId} onComplete={() => setTab("campaign")} />
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
            setTab("analytics");
          }}
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
        Aller a la recherche
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
