import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";

// Dev-only editor quick-login for local/automated testing. Anonymous sessions
// fail both the canEdit gate and the RLS write policy, so real end-to-end
// testing needs a genuine non-anonymous session. This is compiled out of
// production (import.meta.env.DEV is false there) and reads throwaway creds
// from the gitignored .env — see VITE_DEV_EDITOR_* there. Call
// window.__devSignIn() from the console (or the preview harness).
if (import.meta.env.DEV && import.meta.env.VITE_DEV_EDITOR_EMAIL) {
  (window as any).__devSignIn = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: import.meta.env.VITE_DEV_EDITOR_EMAIL as string,
      password: import.meta.env.VITE_DEV_EDITOR_PASSWORD as string,
    });
    if (error) { console.error("[dev] sign-in failed:", error.message); return error.message; }
    // Skip the DisplayNameGate for the throwaway editor by seeding a name.
    if (!data.user?.user_metadata?.display_name) {
      await supabase.auth.updateUser({ data: { display_name: "Dev Editor" } });
    }
    console.info("[dev] signed in as editor:", data.user?.email);
    return "ok";
  };
  console.info("[dev] editor quick-login available: run window.__devSignIn()");
}

type AuthState = {
  user: User | null;
  displayName: string | null;
  /** Discord avatar for OAuth editors; null for email/anonymous sessions. */
  avatarUrl: string | null;
  /** True for non-anonymous (magic-link or Discord) sessions; RLS rejects anonymous writes. */
  canEdit: boolean;
  setDisplayName: (name: string) => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signInWithDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const signingOutRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // A failed OAuth redirect (Discord denied, provider error, …) lands back
    // here with #error=...&error_description=... and no session — without this
    // the app would silently stay anonymous. Strip the params before route.ts
    // can misread them; supabase-js only cleans up successful callbacks.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthError = hashParams.get("error_description") || hashParams.get("error");
    if (oauthError) {
      setAuthNotice(oauthError.replace(/\+/g, " "));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }

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
  const avatarUrl = (user?.user_metadata?.avatar_url as string | undefined) || null;

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

  const signInWithDiscord = async () => {
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
    if (oauthErr) throw oauthErr;
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
      value={{ user, displayName, avatarUrl, canEdit, setDisplayName, signInWithEmail, signInWithDiscord, signOut }}
    >
      {children}
      {authNotice && (
        <AuthNotice message={authNotice} onDismiss={() => setAuthNotice(null)} />
      )}
    </AuthContext.Provider>
  );
}

function AuthNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={{
      position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
      zIndex: 110, maxWidth: 480,
      display: "flex", alignItems: "baseline", gap: 12,
      padding: "10px 16px",
      background: "var(--vellum-light)", color: "var(--ink)",
      boxShadow: "0 6px 24px rgba(40,20,5,.3)",
      border: "1px solid var(--ink-faded)",
      fontFamily: "var(--font-fell)", fontSize: 13,
    }}>
      <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 10, color: "var(--bloodred)", whiteSpace: "nowrap" }}>
        SIGN-IN FAILED
      </span>
      <span style={{ fontStyle: "italic" }}>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--ink-secondary)", fontSize: 14, lineHeight: 1, padding: 0,
        }}
      >
        ✕
      </button>
    </div>
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

  // Discord editors arrive with a provider name in metadata but no
  // display_name — prefill it so accepting is one click, while still letting
  // them type a persona name. Seeded by effect, not useState: the gate is
  // already mounted when the session flips from anonymous to Discord, so an
  // initializer would only ever see the anonymous (empty) metadata.
  const meta = (user?.user_metadata ?? {}) as Record<string, any>;
  const suggested = ((meta.custom_claims?.global_name || meta.full_name || meta.name || "") as string).trim();
  useEffect(() => {
    if (suggested) setDraft((d) => d || suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
  const { signInWithEmail, signInWithDiscord } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
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

  const discord = async () => {
    if (redirecting) return;
    setRedirecting(true);
    setErr(null);
    try {
      // On success the page navigates away to Discord; the redirecting state
      // only shows for the moment before that (or sticks on error below).
      await signInWithDiscord();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRedirecting(false);
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
              Members of the party sign in with Discord or by email to edit the codex.
            </div>
            <button
              onClick={discord}
              disabled={redirecting}
              style={{
                width: "100%", padding: "10px 16px", marginBottom: 18,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                background: "var(--ink)", color: "var(--vellum-light)",
                fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 12,
                border: "none", cursor: redirecting ? "wait" : "pointer",
                opacity: redirecting ? 0.7 : 1,
              }}
            >
              <svg width="16" height="12" viewBox="0 0 127 96" fill="currentColor" aria-hidden="true">
                <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
              </svg>
              {redirecting ? "Opening the portal…" : "Sign in with Discord"}
            </button>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 18,
              fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 10,
              color: "var(--ink-secondary)",
            }}>
              <span style={{ flex: 1, borderTop: "1px solid var(--ink-faded)" }} />
              OR BY EMAIL
              <span style={{ flex: 1, borderTop: "1px solid var(--ink-faded)" }} />
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
