"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/common/Navbar";
import { Button } from "@/components/ui/button";

// ---------- GSI Types ----------
type GoogleCredentialResponse = {
  credential: string;
  select_by: string;
  clientId?: string;
};

type GoogleAccountsId = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
  prompt: () => void;
};

type GoogleGlobal = {
  accounts: {
    id: GoogleAccountsId;
  };
};

declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

// ---------- Config ----------
const REGISTER_ENDPOINT = "https://qzq3ncab46.execute-api.us-west-2.amazonaws.com/prod/log-in"; // <-- change to your real register endpoint
const GOOGLE_CLIENT_ID = "214630517546-2tttdua57o7gj14up16v7s3unqoah46k.apps.googleusercontent.com";

export default function RegisterPage() {
  const router = useRouter();
  const [gsiReady, setGsiReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1) Called by Google when user finishes sign-in
  const handleCredentialResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      try {
        setIsLoading(true);
        setErrorMsg(null);

        const idToken = response.credential;

        const res = await fetch(REGISTER_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: idToken }),
        });

        // If your backend uses 409 for "already exists", handle it nicely
        if (res.status === 409) {
          router.replace("/login");
          return;
        }

        if (!res.ok) {
          const text = await res.text();
          console.error("Register failed:", text);
          setErrorMsg("Registration failed. Please try again.");
          return;
        }

        // Expect same shape as login (token + userData)
        const data: {
          token: string;
          userData: {
            uuid: string;
            email: string;
            name: string;
            pictureUrl: string;
            accountCreatedOn: string;
          };
          // optional backend hint:
          isNewUser?: boolean;
          message?: string;
        } = await res.json();

        localStorage.setItem("clutter_auth_token", data.token);
        localStorage.setItem("clutter_user", JSON.stringify(data.userData));

        // Register intent: send to onboarding by default
        // If backend says NOT new user, you can route to dashboard instead
        if (data.isNewUser === false) {
          router.replace("/dashboard");
          return;
        }

        router.replace("/onboarding/create-org");
      } catch (err) {
        console.error("Error during register flow:", err);
        setErrorMsg("Something went wrong. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  // 2) Initialize GSI once the script is available
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      console.error("Missing GOOGLE_CLIENT_ID");
      return;
    }

    let interval: number | undefined;

    const tryInit = () => {
      if (!window.google) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      });

      setGsiReady(true);
      if (interval !== undefined) window.clearInterval(interval);
    };

    tryInit();

    if (!gsiReady) {
      interval = window.setInterval(tryInit, 300);
    }

    return () => {
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [handleCredentialResponse, gsiReady]);

  // 3) Trigger Google sign-in prompt
  const handleGoogleRegister = () => {
    if (!gsiReady || !window.google) {
      setErrorMsg("Google sign-in is not ready yet. Please wait a second and try again.");
      return;
    }
    window.google.accounts.id.prompt();
  };

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-black text-foreground flex flex-col pt-20 relative overflow-hidden">
      <Navbar showLogin={false} />

      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/[0.05] via-transparent to-green-500/[0.08] blur-3xl" />
        <div className="absolute top-1/4 right-[-5%] w-80 h-80 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute bottom-1/5 left-[-10%] w-96 h-96 rounded-full bg-primary/25 blur-3xl" />
      </div>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="bg-card backdrop-blur-xl rounded-2xl border border-border p-8 shadow-[0_18px_60px_rgba(0,0,0,0.85)]">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold tracking-[0.25em] text-[var(--primary-text)] uppercase mb-3">Create your Re-Clutter account</p>
              <h1 className="text-3xl md:text-4xl font-bold mb-2 tracking-tight">Get started</h1>
              <p className="text-sm text-muted-foreground">Register to create an organization, start projects, and collaborate on diagrams.</p>
            </div>

            <div className="space-y-4">
              <Button
                onClick={handleGoogleRegister}
                className="w-full h-12 bg-white hover:bg-slate-100 text-slate-900 font-medium rounded-lg transition-all transform hover:scale-[1.02] flex items-center justify-center gap-3 shadow-[0_10px_40px_rgba(15,23,42,0.45)]"
                variant="outline"
                disabled={isLoading}>
                <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.6 13.21 17.8 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.5 24.5c0-1.54-.15-3.03-.43-4.5H24v9h12.7c-.55 2.96-2.17 5.48-4.61 7.19l7.14 5.57c4.15-3.83 6.57-9.48 6.57-16.26z" />
                  <path fill="#FBBC05" d="M10.54 28.41A14.4 14.4 0 019.5 24c0-1.52.26-2.98.72-4.36l-7.98-6.19A23.94 23.94 0 000 24c0 3.91.94 7.61 2.61 10.91l7.93-6.5z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.14-5.57c-2.06 1.38-4.67 2.18-7.73 2.18-6.2 0-11.4-3.71-13.46-9.02l-7.93 6.5C6.51 42.62 14.62 48 24 48z" />
                </svg>
                {isLoading ? "Creating your account..." : "Continue with Google"}
              </Button>

              {errorMsg && <p className="text-xs text-red-700 dark:text-red-300 text-center mt-2">{errorMsg}</p>}

              <p className="text-center text-xs text-muted-foreground">
                Already have an account?{" "}
                <a href="/login" className="text-[var(--primary-text)] hover:text-[var(--primary-text)] underline underline-offset-2">
                  Sign in
                </a>
              </p>
            </div>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-card text-muted-foreground">Secure registration powered by Google &amp; Re-Clutter API</span>
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground leading-relaxed">
              By continuing, you agree to our{" "}
              <a href="/terms" className="text-[var(--primary-text)] hover:text-[var(--primary-text)] underline underline-offset-2">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="text-[var(--primary-text)] hover:text-[var(--primary-text)] underline underline-offset-2">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
