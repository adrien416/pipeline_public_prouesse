import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { APP_CONFIG } from "../config";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await login(email, password);
    if (err) setError(err);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f1117] px-4">
      <div className="w-full max-w-sm">
        <div className="bg-[#161822] rounded-2xl shadow-2xl shadow-black/50 border border-white/5 p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-6">
            <img src="https://prouesse.vc/logo-white.png" alt="Prouesse" className="h-9" />
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">{APP_CONFIG.name}</h1>
              <p className="text-xs text-gray-500">{APP_CONFIG.tagline}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="votre@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white font-medium rounded-lg px-4 py-2.5 text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-6 text-xs text-gray-600">
        {APP_CONFIG.brandLine} &middot;{" "}
        <a href={`mailto:${APP_CONFIG.supportEmail}`} className="text-gray-500 hover:text-gray-400 transition-colors">
          {APP_CONFIG.supportEmail}
        </a>
      </p>
    </div>
  );
}
