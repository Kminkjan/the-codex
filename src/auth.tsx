import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";

type AuthState = {
  user: User | null;
  displayName: string | null;
  setDisplayName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: existing } = await supabase.auth.getSession();
      if (cancelled) return;

      if (existing.session) {
        setSession(existing.session);
        setReady(true);
        return;
      }

      const { data, error: signInErr } = await supabase.auth.signInAnonymously();
      if (cancelled) return;
      if (signInErr) {
        setError(
          signInErr.message.includes("Anonymous")
            ? "Anonymous sign-ins are disabled on this Supabase project. Enable them under Authentication → Providers."
            : signInErr.message,
        );
        setReady(true);
        return;
      }
      setSession(data.session);
      setReady(true);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const user = session?.user ?? null;
  const displayName =
    (user?.user_metadata?.display_name as string | undefined)?.trim() || null;

  const setDisplayName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error: updateErr } = await supabase.auth.updateUser({
      data: { display_name: trimmed },
    });
    if (updateErr) throw updateErr;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  if (!ready) return null;
  if (error) return <AuthError message={error} />;

  return (
    <AuthContext.Provider value={{ user, displayName, setDisplayName, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

function AuthError({ message }: { message: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, display: "grid", placeItems: "center",
      background: "var(--vellum)", color: "var(--ink)", padding: 40,
      fontFamily: "var(--font-fell)",
    }}>
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 12, color: "var(--bloodred)", marginBottom: 12 }}>
          ✦ THE GATE IS BARRED ✦
        </div>
        <div style={{ fontStyle: "italic", fontSize: 16, marginBottom: 16 }}>
          The codex could not admit you.
        </div>
        <pre style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--ink-faded)", whiteSpace: "pre-wrap" }}>
          {message}
        </pre>
      </div>
    </div>
  );
}

export function DisplayNameGate({ children }: { children: ReactNode }) {
  const { user, displayName, setDisplayName } = useAuth();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!user) return null;
  if (displayName) return <>{children}</>;

  const submit = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await setDisplayName(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, display: "grid", placeItems: "center",
      background: "var(--vellum)", zIndex: 100,
    }}>
      <div style={{
        maxWidth: 440, textAlign: "center",
        padding: "36px 32px",
        background: "var(--vellum-light)",
        boxShadow: "0 10px 40px rgba(40,20,5,.25)",
        fontFamily: "var(--font-fell)",
      }}>
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 11, color: "var(--ink-faded)", marginBottom: 10 }}>
          ✦ THE CODEX ASKS YOUR NAME ✦
        </div>
        <div style={{ fontStyle: "italic", fontSize: 15, marginBottom: 22, color: "var(--ink)" }}>
          By what name should your notes be signed?
        </div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Seraphine, Kael, the Wanderer…"
          style={{
            width: "100%", padding: "10px 12px", marginBottom: 14,
            background: "transparent",
            border: "1px solid var(--ink-faded)",
            fontFamily: "var(--font-fell)", fontSize: 15, color: "var(--ink)",
            textAlign: "center",
          }}
        />
        <button
          onClick={submit}
          disabled={!draft.trim() || saving}
          style={{
            width: "100%", padding: "10px 16px",
            background: "var(--ink)", color: "var(--vellum-light)",
            fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 12,
            border: "none", cursor: draft.trim() ? "pointer" : "not-allowed",
            opacity: draft.trim() ? 1 : 0.5,
          }}
        >
          {saving ? "Signing the page…" : "Enter the journal"}
        </button>
        {err && (
          <div style={{ marginTop: 14, color: "var(--bloodred)", fontSize: 12, fontStyle: "italic" }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
