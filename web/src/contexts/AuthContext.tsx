import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";

export interface UserInfo {
  email: string;
  nom: string;
  role: "admin" | "user" | "demo";
  userId?: string;
  senderEmail?: string;
  senderName?: string;
}

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  user: UserInfo | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);

  // Check if already authenticated on mount by calling /api/me
  useEffect(() => {
    fetch("/api/me")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setUser({
            email: data.email,
            nom: data.nom,
            role: data.role,
            userId: data.userId,
            senderEmail: data.senderEmail,
            senderName: data.senderName,
          });
          setAuthenticated(true);
        }
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
      const body = await res.json();
      if (body.user) {
        setUser({
          email: body.user.email,
          nom: body.user.nom,
          role: body.user.role,
        });
      }
      setAuthenticated(true);
      return null;
    }
    const body = await res.json().catch(() => ({ error: "Erreur réseau" }));
    return body.error || "Erreur inconnue";
  }, []);

  const logout = useCallback(() => {
    document.cookie = "auth_token=; Path=/; Max-Age=0";
    setAuthenticated(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, loading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
