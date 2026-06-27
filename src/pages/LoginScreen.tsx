import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Lock, User } from 'lucide-react';

export function LoginScreen() {
  const { login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.setTimeout(() => usernameRef.current?.focus(), 100);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !pin.trim()) {
      setError('Username and PIN are required');
      return;
    }
    setIsSubmitting(true);
    const result = await login(username, pin);
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.message || 'Login failed');
      setPin('');
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-2xl font-black text-white tracking-tight">Shubhraj Mini Mart</div>
          <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">Terminal Login</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                ref={usernameRef}
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const pinInput = document.getElementById('login-pin') as HTMLInputElement | null;
                    pinInput?.focus();
                  }
                }}
                className="h-11 w-full rounded border border-slate-600 bg-slate-900 pl-10 pr-3 text-sm font-bold text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. admin"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">PIN</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="h-11 w-full rounded border border-slate-600 bg-slate-900 pl-10 pr-3 text-sm font-bold text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="4-6 digits"
              />
            </div>
          </div>

          {error && (
            <div className="rounded border border-rose-800 bg-rose-900/30 px-3 py-2 text-xs font-bold text-rose-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded bg-blue-600 text-sm font-black uppercase tracking-wider text-white shadow-lg hover:bg-blue-500 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4 text-center text-[10px] font-bold text-slate-500">
          Default: admin / 1234
        </div>
      </div>
    </div>
  );
}
