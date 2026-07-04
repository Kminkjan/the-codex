import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";

type AuthState = {
  user: User | null;
  displayName: string | null;
  /** True for non-anonymous (magic-link) sessions; RLS rejects anonymous writes. */
  canEdit: boolean;
  setDisplayName: (name: string) => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingOutRef = useRef(false);

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
      // During signOut the SIGNED_OUT event would blank the app (null user
      // unmounts everything behind DisplayNameGate) before the replacement
      // anonymous session lands — signOut() sets the session itself.
      if (signingOutRef.current) return;
      setSession(s);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const user = session?.user ?? null;
  const canEdit = !!user && !user.is_anonymous;
  const displayName =
    (user?.user_metadata?.display_name as string | undefined)?.trim() ||
    (user?.email ? user.email.split("@")[0] : null);

  const setDisplayName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error: updateErr } = await supabase.auth.updateUser({
      data: { display_name: trimmed },
    });
    if (updateErr) throw updateErr;
  };

  const signInWithEmail = async (email: string) => {
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (otpErr) throw otpErr;
  };

  const signOut = async () => {
    // Drop back to read-only viewing instead of a blank screen: the app
    // always expects a session (anonymous = viewer).
    signingOutRef.current = true;
    try {
      await supabase.auth.signOut();
      const { data, error: signInErr } = await supabase.auth.signInAnonymously();
      if (signInErr) {
        setError(signInErr.message);
        setSession(null);
        return;
      }
      setSession(data.session ?? null);
    } finally {
      signingOutRef.current = false;
    }
  };

  if (!ready) return null;
  if (error) return <AuthError message={error} />;

  return (
    <AuthContext.Provider
      value={{ user, displayName, canEdit, setDisplayName, signInWithEmail, signOut }}
    >
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
        <pre style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--ink-secondary)", whiteSpace: "pre-wrap" }}>
          {message}
        </pre>
      </div>
    </div>
  );
}

export function DisplayNameGate({ children }: { children: ReactNode }) {
  const { user, setDisplayName } = useAuth();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!user) return null;
  // Anonymous visitors are read-only viewers — the name only signs party
  // notes, which they can't write, so skip the gate for them. Editors are
  // gated on the metadata name specifically (not the email-prefix fallback
  // in displayName), so a first-time editor still gets to pick a name.
  const metadataName = (user.user_metadata?.display_name as string | undefined)?.trim();
  if (user.is_anonymous || metadataName) return <>{children}</>;

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
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 11, color: "var(--ink-secondary)", marginBottom: 10 }}>
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

export function SignInDialog({ onClose }: { onClose: () => void }) {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      await signInWithEmail(email);
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(40,20,5,.45)", zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 440, width: "90%", textAlign: "center",
          padding: "36px 32px",
          background: "var(--vellum-light)",
          boxShadow: "0 10px 40px rgba(40,20,5,.25)",
          fontFamily: "var(--font-fell)",
        }}
      >
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 11, color: "var(--ink-secondary)", marginBottom: 10 }}>
          ✦ PROVE YOUR MEMBERSHIP ✦
        </div>
        {sent ? (
          <div style={{ fontStyle: "italic", fontSize: 15, color: "var(--ink)" }}>
            A sign-in link has been sent to <strong>{email.trim()}</strong>.
            <br />Check your email, then return here.
          </div>
        ) : (
          <>
            <div style={{ fontStyle: "italic", fontSize: 15, marginBottom: 22, color: "var(--ink)" }}>
              Members of the party sign in by email to edit the codex.
            </div>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="you@example.com"
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
              disabled={!email.trim() || sending}
              style={{
                width: "100%", padding: "10px 16px",
                background: "var(--ink)", color: "var(--vellum-light)",
                fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 12,
                border: "none", cursor: email.trim() ? "pointer" : "not-allowed",
                opacity: email.trim() ? 1 : 0.5,
              }}
            >
              {sending ? "Sending the raven…" : "Send sign-in link"}
            </button>
          </>
        )}
        {err && (
          <div style={{ marginTop: 14, color: "var(--bloodred)", fontSize: 12, fontStyle: "italic" }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
