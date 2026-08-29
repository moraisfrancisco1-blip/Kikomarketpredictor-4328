import { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, Activity } from "lucide-react";

const SESSION_KEY = "mp_auth";
// Senha padrão — mude aqui para a sua senha pessoal
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD ?? "predictor2025";

function check(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "ok";
  } catch {
    return false;
  }
}

function save() {
  try {
    sessionStorage.setItem(SESSION_KEY, "ok");
  } catch {}
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(check);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);

  // Re-check on focus (e.g. after closing another tab)
  useEffect(() => {
    const handler = () => setAuthed(check());
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, []);

  if (authed) return <>{children}</>;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password === APP_PASSWORD) {
      save();
      setAuthed(true);
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 600);
      setPassword("");
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4"
      style={{ background: "var(--mp-bg, #f4f6fb)" }}>
      <div className={`w-full max-w-sm ${shake ? "animate-shake" : ""}`}>
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: "#e0f2fe", border: "1px solid #bae6fd" }}>
            <Activity size={28} style={{ color: "#0284c7" }} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0f172a" }}>Market Predictor</h1>
          <p className="text-sm" style={{ color: "#64748b" }}>Acesso restrito</p>
        </div>

        {/* Card */}
        <form onSubmit={submit}
          className="rounded-2xl p-6 flex flex-col gap-4 shadow-sm"
          style={{ background: "#ffffff", border: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-2 text-sm font-medium mb-1" style={{ color: "#475569" }}>
            <Lock size={14} />
            Senha
          </div>

          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false); }}
              placeholder="Digite a senha..."
              autoFocus
              className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-all"
              style={{
                background: "#f8fafc",
                border: `1px solid ${error ? "#ef4444" : "#e2e8f0"}`,
                color: "#0f172a",
              }}
            />
            <button type="button" onClick={() => setShow(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
              style={{ color: "#94a3b8" }}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <p className="text-xs -mt-1" style={{ color: "#ef4444" }}>Senha incorreta. Tente novamente.</p>
          )}

          <button type="submit"
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "#0284c7" }}>
            Entrar
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: "#94a3b8" }}>
          Acesso privado · Market Predictor
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
}
