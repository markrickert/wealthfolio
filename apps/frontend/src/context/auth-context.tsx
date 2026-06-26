import { isWeb } from "@/adapters";
import { setUnauthorizedHandler } from "@/lib/auth-token";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface AuthContextValue {
  requiresAuth: boolean;
  requiresPassword: boolean;
  oidcEnabled: boolean;
  isAuthenticated: boolean;
  statusLoading: boolean;
  loginLoading: boolean;
  loginError: string | null;
  login: (password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

/** Human-readable messages for `?oidc_error=` codes set by the server callback. */
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  oidc_forbidden: "Your account is not allowed to access this instance.",
  oidc_provider_error: "The identity provider reported an error. Please try again.",
  oidc_expired: "Your sign-in session expired. Please try again.",
  oidc_state_mismatch: "Sign-in could not be verified. Please try again.",
  oidc_exchange_failed: "Could not complete sign-in with the identity provider.",
  oidc_invalid_token: "The identity provider returned an invalid token.",
  oidc_no_id_token: "The identity provider did not return an ID token.",
  oidc_missing_params: "Sign-in was cancelled or incomplete. Please try again.",
  oidc_not_configured: "Single sign-on is not configured on this server.",
  oidc_internal: "An unexpected error occurred during sign-in. Please try again.",
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [statusLoading, setStatusLoading] = useState(isWeb);
  const [cookieSession, setCookieSession] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const cookieSessionRef = useRef(false);

  useEffect(() => {
    cookieSessionRef.current = cookieSession;
  }, [cookieSession]);

  useEffect(() => {
    if (!isWeb) {
      setStatusLoading(false);
      return;
    }
    let cancelled = false;
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/v1/auth/status", {
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(`Failed to check authentication status: ${response.status}`);
        }
        const data = (await response.json()) as {
          requiresPassword: boolean;
          oidcEnabled: boolean;
        };
        if (cancelled) return;
        const needsPassword = Boolean(data?.requiresPassword);
        const needsOidc = Boolean(data?.oidcEnabled);
        setRequiresPassword(needsPassword);
        setOidcEnabled(needsOidc);
        const needsAuth = needsPassword || needsOidc;

        // If auth is required, check if we have a valid cookie session
        if (needsAuth) {
          try {
            const meRes = await fetch("/api/v1/auth/me", {
              credentials: "same-origin",
            });
            if (meRes.ok && !cancelled) {
              setCookieSession(true);
            }
          } catch {
            // No valid session, user will need to log in
          }
        }
      } catch (error) {
        console.error("Failed to load authentication status", error);
        if (!cancelled) {
          setRequiresPassword(false);
          setOidcEnabled(false);
        }
      } finally {
        if (!cancelled) {
          setStatusLoading(false);
        }
      }
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const hadSession = cookieSessionRef.current;
      setCookieSession(false);
      if (hadSession) {
        setLoginError("Session expired. Please sign in again.");
      }
    };
    setUnauthorizedHandler(handler);
    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  // Surface OIDC callback errors passed back as `?oidc_error=<code>`.
  useEffect(() => {
    if (!isWeb) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oidc_error");
    if (!code) return;
    setLoginError(OIDC_ERROR_MESSAGES[code] ?? "Single sign-on failed. Please try again.");
    params.delete("oidc_error");
    const query = params.toString();
    const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
  }, []);

  const login = useCallback(async (password: string) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });
      if (!response.ok) {
        if (response.status === 404) {
          setRequiresPassword(false);
        }
        let message = "Invalid password";
        try {
          const body = await response.json();
          message = body?.message ?? message;
        } catch (parseError) {
          console.error("Failed to parse login error", parseError);
        }
        throw new Error(message);
      }
      // Cookie is set by the server via Set-Cookie header
      setCookieSession(true);
      setLoginError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      setCookieSession(false);
      setLoginError(message);
      throw error;
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Clear server-side cookie session
    if (isWeb) {
      fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {});
    }
    setCookieSession(false);
    setLoginError(null);
  }, []);

  const clearError = useCallback(() => setLoginError(null), []);

  const requiresAuth = requiresPassword || oidcEnabled;

  const value = useMemo<AuthContextValue>(
    () => ({
      requiresAuth,
      requiresPassword,
      oidcEnabled,
      isAuthenticated: !requiresAuth || cookieSession,
      statusLoading,
      loginLoading,
      loginError,
      login,
      logout,
      clearError,
    }),
    [
      requiresAuth,
      requiresPassword,
      oidcEnabled,
      cookieSession,
      statusLoading,
      loginLoading,
      loginError,
      login,
      logout,
      clearError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
};

export function AuthGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { requiresAuth, isAuthenticated, statusLoading } = useAuth();

  if (statusLoading) {
    return (
      <div className="bg-background text-muted-foreground flex min-h-screen items-center justify-center">
        Checking authentication...
      </div>
    );
  }

  if (requiresAuth && !isAuthenticated) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
