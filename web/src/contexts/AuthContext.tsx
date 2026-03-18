import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check if already authenticated on mount
  useEffect(() => {
    fetch("/api/credits")
      .then((r) => {
        setAuthenticated(r.ok);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      setAuthenticated(true);
      return null;
    }
    const body = await res.json().catch(() => ({ error: "Erreur réseau" }));
    return body.error || "Erreur inconnue";
  }, []);

  const logout = useCallback(() => {
    document.cookie = "auth_token=; Path=/; Max-Age=0";
    setAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
