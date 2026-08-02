// Module-level signer store: who is writing, for the columns that record it
// (party_notes.author/author_user_id, session_events, connections, and
// session_attendance.recorded_by). Written only by AuthProvider, synchronously
// during render; read by mutations.ts, which are plain async functions and
// can't reach React context — the same reason activeCampaign.ts and
// activeSession.ts exist.
//
// This is why no mutation takes an `author` parameter. Until 0040 every write
// site passed its own `displayName` from useAuth(), which meant eight call
// sites each had to remember to sign, and the name and the uuid could drift
// apart. Signing is one fact about the session, not an argument.
//
// Null for anonymous viewers and between sign-out and the anonymous re-sign-in.
// Mutations tolerate that: RLS rejects anonymous writes anyway (0006), so a
// null signer only ever means "this write is about to fail for a better
// reason". Callers must not read this to decide whether to render an edit
// affordance — that is useAuth().canEdit's job.
export interface Signer {
  userId: string;
  // Can be null for an editor who hasn't passed the DisplayNameGate yet.
  displayName: string | null;
}

let signer: Signer | null = null;

export function setSigner(next: Signer | null) {
  signer = next;
}

export function getSigner(): Signer | null {
  return signer;
}
