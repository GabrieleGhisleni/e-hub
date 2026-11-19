import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID, completeLogin } from "../session";

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

const GIS_SRC = "https://accounts.google.com/gsi/client";

function loadGoogleScript(): Promise<GoogleIdentity> {
  const existing = (window as { google?: GoogleIdentity }).google;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve((window as unknown as { google: GoogleIdentity }).google);
    script.onerror = () => reject(new Error("Google non raggiungibile."));
    document.head.append(script);
  });
}

/** The "Sign in with Google" button of Google Identity Services. */
export function GoogleSignIn() {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let active = true;
    loadGoogleScript().then(
      (google) => {
        if (!active || !holder.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            completeLogin(response.credential).catch((e: unknown) =>
              setError(e instanceof Error ? e.message : "Accesso non riuscito."),
            );
          },
        });
        google.accounts.id.renderButton(holder.current, { type: "standard", size: "medium", theme: "outline", text: "signin" });
      },
      (e: unknown) => active && setError(e instanceof Error ? e.message : "Google non raggiungibile."),
    );
    return () => {
      active = false;
    };
  }, []);
  if (!GOOGLE_CLIENT_ID) return null;
  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <div ref={holder} />
    </div>
  );
}
