import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { apiRequest, getAuthToken, setAuthToken } from "./api";

type User = Record<string, unknown> & {
  id?: string;
  email?: string;
  name?: string;
  tenant?: string;
  roles?: string[];
};

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function tokenFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.token, record.accessToken, record.jwt, record.idToken];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  if (record.auth && typeof record.auth === "object") {
    return tokenFromPayload(record.auth);
  }

  return null;
}

function userFromPayload(payload: unknown): User | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.user && typeof record.user === "object") {
    return record.user as User;
  }

  if (record.profile && typeof record.profile === "object") {
    return record.profile as User;
  }

  if ("email" in record || "name" in record || "roles" in record) {
    return record as User;
  }

  return null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(getAuthToken()));
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const payload = await apiRequest<unknown>("/api/auth/me");
    setUser(userFromPayload(payload));
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    refreshMe()
      .catch(() => {
        if (mounted) {
          logout();
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [logout, refreshMe, token]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const payload = await apiRequest<unknown>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      const nextToken = tokenFromPayload(payload);

      if (!nextToken) {
        throw new Error("Login response did not include a JWT.");
      }

      setAuthToken(nextToken);
      setToken(nextToken);
      setUser(userFromPayload(payload));

      try {
        const me = await apiRequest<unknown>("/api/auth/me");
        setUser(userFromPayload(me) ?? userFromPayload(payload));
      } catch {
        setUser(userFromPayload(payload) ?? { email });
      }
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Unable to sign in.";
      setError(message);
      setAuthToken(null);
      setToken(null);
      setUser(null);
      throw loginError;
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      error,
      isAuthenticated: Boolean(token),
      login,
      logout
    }),
    [error, loading, login, logout, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
