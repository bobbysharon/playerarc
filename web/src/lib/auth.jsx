import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, getToken } from './api';

const AuthContext = createContext(null);

/** Kept in sync with server/src/lib/permissions.js SUPER_ADMIN_DENIED. */
const SUPER_ADMIN_DENIED = ['training.write', 'assessments.write', 'achievements.write'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    /** Re-read the signed-in user, e.g. after they change their own password or a forced password change. */
    async refresh() {
      const d = await api.get('/auth/me');
      setUser(d.user);
      return d.user;
    },
    async signIn(email, password) {
      const data = await api.post('/auth/login', { email, password });
      setToken(data.token);
      setUser(data.user);
      return data.user;
    },
    async signOut() {
      try { await api.post('/auth/logout'); } catch { /* token may already be gone */ }
      setToken(null);
      setUser(null);
    },
    /**
     * Mirrors the server permission matrix — the API enforces it regardless.
     * The Super Admin's '*' covers everything except logging training,
     * assessments or achievements/awards, which stay with coaches/sport admins.
     */
    can(permission) {
      if (!user) return false;
      if (user.permissions.includes('*')) {
        if (user.role === 'super_admin' && SUPER_ADMIN_DENIED.includes(permission)) return false;
        return true;
      }
      return user.permissions.includes(permission);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
