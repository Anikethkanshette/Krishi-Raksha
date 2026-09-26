import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { configureSession, request } from './api';
import { jsonBody } from './local-api';
import { storage } from './utils/storage';

WebBrowser.maybeCompleteAuthSession();
export const SESSION_KEY = 'krushi_session';
const PENDING_KEY = 'krushi_oauth_pending';
type User = {user_id: string; email: string; name: string; picture: string};
type AuthState = {user: User | null; loading: boolean; busy: boolean; error: string; signIn: () => Promise<void>; signOut: () => Promise<void>; retry: () => void};
const AuthContext = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(AuthContext);
const exchanges = new Map<string, Promise<{session_token: string; user: User}>>();
const parameter = (url: string, name: string) => { const match = url.match(new RegExp(`[?#&]${name}=([^&#]+)`)); return match ? decodeURIComponent(match[1]) : ''; };

export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const received = useRef('');
  const generation = useRef(0);
  const clear = useCallback(async () => {
    generation.current += 1;
    configureSession(''); setUser(null);
    await storage.secureRemove(SESSION_KEY);
  }, []);

  const callback = useCallback(async (url: string) => {
    const id = parameter(url, 'session_id');
    if (!id) return false;
    setBusy(true); setError('');
    try {
      let pending = exchanges.get(id);
      if (!pending) {
        const raw = await storage.secureGet<string | null>(PENDING_KEY, null);
        const state = raw ? JSON.parse(raw) : null;
        if (!state || state.nonce !== parameter(url, 'oauth_state') || Date.now() - state.time > 15 * 60 * 1000) throw new Error('This sign-in link is no longer valid. Please start Google sign-in again.');
        // Check again after awaiting storage, before initiating the only exchange.
        pending = exchanges.get(id);
        if (!pending) { pending = request<{session_token: string; user: User}>('/auth/session', jsonBody({session_id: id})); exchanges.set(id, pending); }
      }
      const currentGeneration = generation.current;
      const result = await pending;
      if (generation.current !== currentGeneration) return true;
      if (!await storage.secureSet(SESSION_KEY, result.session_token)) throw new Error('Could not securely save your session. Please try again.');
      configureSession(result.session_token, () => { void clear(); });
      setUser(result.user);
      await storage.secureRemove(PENDING_KEY);
      if (Platform.OS === 'web') {
        const cleaned = new URL(window.location.href);
        ['session_id', 'oauth_state'].forEach(k => cleaned.searchParams.delete(k));
        const fragment = new URLSearchParams(cleaned.hash.slice(1));
        ['session_id', 'oauth_state'].forEach(k => fragment.delete(k));
        cleaned.hash = fragment.toString();
        window.history.replaceState(window.history.state, '', cleaned.toString());
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Google sign-in failed. Please try again.'); }
    finally { setBusy(false); setLoading(false); }
    return true;
  }, [clear]);

  useEffect(() => {
    let alive = true;
    const subscription = Linking.addEventListener('url', ({url}) => { received.current = url; void callback(url); });
    void (async () => {
      setLoading(true); setError('');
      const url = Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL();
      if (url && await callback(url)) return;
      const token = await storage.secureGet<string | null>(SESSION_KEY, null);
      if (!alive) return;
      if (token) {
        configureSession(token, () => { void clear(); });
        try { const current = await request<User>('/auth/me'); if (alive) setUser(current); }
        catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Could not check your session.'); }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; subscription.remove(); };
  }, [attempt, callback, clear]);

  const signIn = async () => {
    if (busy) return;
    setBusy(true); setError(''); received.current = '';
    try {
      const nonce = Crypto.randomUUID();
      if (!await storage.secureSet(PENDING_KEY, JSON.stringify({nonce, time: Date.now()}))) throw new Error('Secure storage is unavailable. Please try again.');
      const base = Platform.OS === 'web' ? `${window.location.origin}/` : Linking.createURL('');
      const redirect = `${base}${base.includes('?') ? '&' : '?'}oauth_state=${nonce}`;
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      if (Platform.OS === 'web') { window.location.href = authUrl; return; }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, base);
      const url = result.type === 'success' ? result.url : received.current || await Linking.getInitialURL();
      if (url && parameter(url, 'session_id')) await callback(url);
      else setError('Sign-in was cancelled. You can try again whenever you are ready.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open Google sign-in.'); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true);
    try { await request('/auth/logout', {method: 'POST'}); await clear(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out. Please try again.'); throw e; }
    finally { setBusy(false); }
  };
  return <AuthContext.Provider value={{user, loading, busy, error, signIn, signOut, retry: () => setAttempt(v => v + 1)}}>{children}</AuthContext.Provider>;
}