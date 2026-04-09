import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Layout, type Tab } from "./components/Layout";
import { InitialSetupPage } from "./pages/InitialSetupPage";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizardPage } from "./pages/SetupWizardPage";
import { SearchPage } from "./pages/SearchPage";
import { ScoringPage } from "./pages/ScoringPage";
import { EnrichPage } from "./pages/EnrichPage";
import { CampaignPage } from "./pages/CampaignPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { Spinner } from "./components/Spinner";
import { checkSetup, getAppStatus } from "./api/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function loadSavedState() {
  try {
    const saved = localStorage.getItem("pipeline_session");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

function AppContent() {
  const { authenticated, loading } = useAuth();

  const saved = loadSavedState();
  const [tab, setTab] = useState<Tab>(saved?.tab || "search");
  const [rechercheId, setRechercheId] = useState<string | null>(saved?.rechercheId || null);
  const [campaignId, setCampaignId] = useState<string | null>(saved?.campaignId || null);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [appConfigured, setAppConfigured] = useState<boolean | null>(null);

  // Check if app is configured (unauthenticated — before login)
  useEffect(() => {
    getAppStatus()
      .then((r) => setAppConfigured(r.configured))
      .catch(() => setAppConfigured(true)); // If check fails, assume configured
  }, []);

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem("pipeline_session", JSON.stringify({
      tab, rechercheId, campaignId,
    }));
  }, [tab, rechercheId, campaignId]);

  // Check if setup is complete after login
  useEffect(() => {
    if (!authenticated) return;
    // If user explicitly completed setup, skip the check
    if (localStorage.getItem("pipeline_setup_done") === "true") {
      setSetupDone(true);
      return;
    }
    checkSetup()
      .then((r) => setSetupDone(r.configured))
      .catch(() => setSetupDone(true)); // If check fails, assume configured
  }, [authenticated]);

  function goTo(target: Tab) {
    setTab(target);
  }

  /** Load a previous search (from search selector) */
  function loadRecherche(id: string, targetTab?: Tab) {
    setRechercheId(id);
    setCampaignId(null);
    if (targetTab) {
      setTab(targetTab);
    }
  }

  if (loading || appConfigured === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!appConfigured) {
    return (
      <InitialSetupPage
        onComplete={() => {
          setAppConfigured(true);
          window.location.reload();
        }}
      />
    );
  }

  if (!authenticated) return <LoginPage />;

  if (setupDone === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!setupDone) {
    return (
      <SetupWizardPage
        onComplete={() => {
          localStorage.setItem("pipeline_setup_done", "true");
          setSetupDone(true);
        }}
      />
    );
  }

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === "search" && (
        <SearchPage
          onComplete={(id) => {
            setRechercheId(id);
            goTo("scoring");
          }}
          onLoadRecherche={loadRecherche}
        />
      )}
      {tab === "scoring" && rechercheId && (
        <ScoringPage
          key={rechercheId}
          rechercheId={rechercheId}
          onComplete={() => goTo("enrich")}
          onBackToSearch={() => setTab("search")}
        />
      )}
      {tab === "scoring" && !rechercheId && (
        <EmptyState message="Sélectionne une recherche dans l'onglet Recherche" onAction={() => setTab("search")} />
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
        <EmptyState message="Sélectionne une recherche dans l'onglet Recherche" onAction={() => setTab("search")} />
      )}
      {tab === "campaign" && rechercheId && (
        <CampaignPage
          rechercheId={rechercheId}
          onComplete={(cId) => {
            setCampaignId(cId);
            goTo("analytics");
          }}
          onNavigateToSearch={(id) => loadRecherche(id, "campaign")}
        />
      )}
      {tab === "campaign" && !rechercheId && (
        <EmptyState message="Sélectionne une recherche dans l'onglet Recherche" onAction={() => setTab("search")} />
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
