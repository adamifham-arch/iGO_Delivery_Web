import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);
const rememberPreferenceKey = 'igo-remember-me';

const authStorage = {
  getItem(key) {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  },
  setItem(key, value) {
    const remember = localStorage.getItem(rememberPreferenceKey) === 'true';
    const targetStorage = remember ? localStorage : sessionStorage;
    const otherStorage = remember ? sessionStorage : localStorage;
    otherStorage.removeItem(key);
    targetStorage.setItem(key, value);
  },
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const setAuthRememberMe = (remember) => {
  localStorage.setItem(rememberPreferenceKey, remember ? 'true' : 'false');
};

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, { auth: { storage: authStorage, persistSession: true } })
  : null;
