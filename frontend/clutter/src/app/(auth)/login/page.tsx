"use client";

import Navbar from "@/components/common/Navbar";
import { organizationApi } from "@/lib/features/organization/api";
import { useOrganizations } from "@/lib/features/organization/hooks";
import {
  useLoginWithGoogle,
  useLogout,
  useMe,
} from "@/lib/features/user/hooks";
import { GoogleLogin } from "@react-oauth/google";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function isTokenExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

function getErrorStatus(error: unknown): number | null {
  const err = error as {
    status?: number;
    response?: { status?: number };
  };

  return err?.response?.status ?? err?.status ?? null;
}

export default function LoginPage() {
  const router = useRouter();

  const login = useLoginWithGoogle();
  const logout = useLogout();
  const meQ = useMe();

  const [postLoginError, setPostLoginError] = useState<string | null>(null);
  const [isResolvingLogin, setIsResolvingLogin] = useState(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<
    string | null
  >(null);

  const rawToken = meQ.data?.token ?? null;
  const token = rawToken && !isTokenExpired(rawToken) ? rawToken : null;

  const orgsQ = useOrganizations(token);

  const hasOrg = useMemo(() => {
    const orgs = orgsQ.data ?? [];
    return orgs.length > 0;
  }, [orgsQ.data]);

  useEffect(() => {
    if (!rawToken) return;

    if (isTokenExpired(rawToken)) {
      logout();
      setSessionExpiredMessage("Your session expired. Please sign in again.");
      setPostLoginError(null);
    }
  }, [rawToken, logout]);

  useEffect(() => {
    if (!token) return;
    if (orgsQ.isLoading) return;

    const status = getErrorStatus(orgsQ.error);

    if (status === 403) {
      logout();
      setSessionExpiredMessage("Your session expired. Please sign in again.");
      return;
    }

    if (orgsQ.isError) return;

    router.replace(hasOrg ? "/dashboard" : "/onboarding/create-org");
  }, [
    token,
    orgsQ.isLoading,
    orgsQ.isError,
    orgsQ.error,
    hasOrg,
    router,
    logout,
  ]);

  const isChecking = !!token && orgsQ.isLoading;

  const routeAfterLogin = async (authToken: string) => {
    const fetchOrganizations = async () => organizationApi.list(authToken);

    try {
      const orgs = await fetchOrganizations();
      router.replace(orgs.length > 0 ? "/dashboard" : "/onboarding/create-org");
      return;
    } catch {
      // One quick retry smooths over the transient first-request failure seen after login.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 300));

    try {
      const orgs = await fetchOrganizations();
      router.replace(orgs.length > 0 ? "/dashboard" : "/onboarding/create-org");
    } catch (err) {
      const status = getErrorStatus(err);

      if (status === 403) {
        logout();
        setSessionExpiredMessage("Your session expired. Please sign in again.");
        return;
      }

      throw err;
    }
  };

  const orgErrorStatus = getErrorStatus(orgsQ.error);
  const showOrgNetworkError = orgsQ.isError && orgErrorStatus !== 403;

  return (
    <div className="product-public login-page">
      <Navbar showLogin={false} />
      <main className="login-layout">
        <section className="login-form-panel" aria-labelledby="login-heading">
          <div className="login-form-inner">
            <p className="login-workspace-label">Re-Clutter workspace</p>
            <h1 id="login-heading" className="section-heading">
              Welcome back.
            </h1>
            <p className="login-description">
              Your cloud infrastructure, all in one place.
              <br />
              Sign in to continue building.
            </p>
            <div className="google-signin-container">
              <GoogleLogin
                theme="outline"
                size="large"
                shape="rectangular"
                width="300"
                onSuccess={async (credentialResponse) => {
                  const googleIdToken = credentialResponse.credential;
                  if (!googleIdToken) {
                    console.error("No Google ID token returned");
                    return;
                  }

                  setPostLoginError(null);
                  setSessionExpiredMessage(null);
                  setIsResolvingLogin(true);

                  try {
                    const user = await login.mutateAsync(googleIdToken);
                    await routeAfterLogin(user.token);
                  } catch (err) {
                    console.error(err);
                    setPostLoginError(String(err));
                  } finally {
                    setIsResolvingLogin(false);
                  }
                }}
                onError={() => console.log("Login Failed")}
              />
            </div>

            {(isChecking || isResolvingLogin) && (
              <div className="mt-6 text-center text-sm text-muted-foreground">
                Checking your organizations…
              </div>
            )}

            {(sessionExpiredMessage ||
              login.isError ||
              meQ.isError ||
              showOrgNetworkError ||
              postLoginError) && (
              <div className="mt-6 text-sm text-red-700 dark:text-red-300">
                {sessionExpiredMessage && <div>{sessionExpiredMessage}</div>}
                {login.isError && <div>Login error: {String(login.error)}</div>}
                {meQ.isError && <div>Auth error: {String(meQ.error)}</div>}
                {showOrgNetworkError && (
                  <div>Organization lookup error: {String(orgsQ.error)}</div>
                )}
                {postLoginError && <div>Login error: {postLoginError}</div>}
              </div>
            )}

            <p className="mt-5 text-center text-sm leading-6 text-muted-foreground">
              Continue with your Google account to access your workspace.
            </p>
          </div>
        </section>
        <p className="login-form-footer">A clearer way to build your cloud.</p>
        <div
          className="login-capabilities"
          aria-label="Design, connect, deploy"
        >
          <span>Design</span>
          <span aria-hidden="true">·</span>
          <span>Connect</span>
          <span aria-hidden="true">·</span>
          <span>Deploy</span>
        </div>
      </main>
    </div>
  );
}
