import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api.get("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  async function login(email, password) {
    const r = await api.post("/api/auth/login", { email, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }

  async function changePassword(current, next) {
    const r = await api.post("/api/auth/change-password", { current_password: current, new_password: next });
    setToken(r.token);
    setUser(r.user);
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const isAdmin = (u) => u?.role === "admin";
export const canEdit = (u) => u?.role === "analyst";
