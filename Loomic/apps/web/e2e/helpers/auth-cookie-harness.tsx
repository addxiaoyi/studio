import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../../src/lib/auth-context";
import { signInLocalWithPassword } from "../../src/lib/local-auth";

function SessionProbe() {
  const auth = useAuth();
  const [failure, setFailure] = useState("");
  async function login(email: string) {
    try {
      auth.acceptSession(
        await signInLocalWithPassword(email, "fixture-password"),
      );
    } catch (cause) {
      setFailure(String(cause));
    }
  }
  return (
    <main>
      <h1>Cookie session ordering</h1>
      <output data-testid="identity">{auth.user?.id ?? "none"}</output>
      <output data-testid="loading">{String(auth.loading)}</output>
      <output data-testid="failure">
        {failure || auth.sessionError?.message || "none"}
      </output>
      <button type="button" onClick={() => void login("old@example.test")}>
        Login old
      </button>
      <button type="button" onClick={() => void login("fresh@example.test")}>
        Login fresh
      </button>
      <button type="button" onClick={() => void login("latest@example.test")}>
        Login latest
      </button>
      <button
        type="button"
        onClick={() =>
          void auth.signOut().catch((cause) => setFailure(String(cause)))
        }
      >
        Sign out
      </button>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Auth browser fixture root is missing");
createRoot(root).render(
  <AuthProvider>
    <SessionProbe />
  </AuthProvider>,
);
