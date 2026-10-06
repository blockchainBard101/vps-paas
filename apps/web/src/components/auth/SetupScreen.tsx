'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Server, Lock, ArrowRight, Check, AlertCircle, Loader2 } from 'lucide-react';
import { PostgresLogo, RedisLogo } from '../icons/DatabaseLogos';

interface SetupScreenProps {
  onComplete: (token: string, user: any, instanceName: string) => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [step, setStep] = useState<'welcome' | 'form'>('welcome');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [form, setForm] = useState({
    instanceName: '',
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const API_BASE =
    typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api')
      : 'http://localhost:4000/api';

  const passwordStrength = (() => {
    const p = form.password;
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  })();

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'][passwordStrength];
  const strengthColor = [
    '',
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-emerald-500',
    'bg-emerald-400',
  ][passwordStrength];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          name: form.name.trim() || undefined,
          instanceName: form.instanceName.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || 'Setup failed');
      }
      const data = await res.json();
      onComplete(data.token, data.user, data.instanceName);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }

  if (step === 'welcome') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 font-sans">
        {/* Background glow */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 max-w-lg w-full text-center space-y-8">
          {/* Logo / Badge */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-600/40">
              <Server className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-zinc-100 tracking-tight">Welcome to VPS Cloud</h1>
              <p className="text-zinc-400 text-sm mt-1">
                Your self-hosted PaaS control plane is ready to configure.
              </p>
            </div>
          </div>

          {/* Feature pills */}
          <div className="grid grid-cols-2 gap-3 text-left">
            {[
              { icon: <PostgresLogo className="w-4 h-4" />, label: 'PostgreSQL Databases', color: 'indigo' },
              { icon: <RedisLogo className="w-4 h-4" />, label: 'Redis Cache', color: 'rose' },
              { icon: <Lock className="w-4 h-4 text-emerald-400" />, label: 'Secure Password Auth', color: 'emerald' },
              { icon: <Server className="w-4 h-4 text-sky-400" />, label: 'Docker Orchestration', color: 'sky' },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 flex items-center gap-3"
              >
                <div className="shrink-0">{icon}</div>
                <span className="text-xs font-medium text-zinc-300">{label}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={() => setStep('form')}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <span>Set Up Your Admin Account</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <p className="text-xs text-zinc-600">
            This only runs once. Your credentials are stored securely on-server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 font-sans">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-indigo-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-zinc-100 text-lg leading-tight">Create Admin Account</h2>
            <p className="text-zinc-500 text-xs">Initial server setup · One-time only</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Instance Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Instance Name <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={form.instanceName}
              onChange={(e) => setForm({ ...form, instanceName: e.target.value })}
              placeholder="My Production Cloud"
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Your Name <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. John Doe"
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Admin Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Password <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 8 characters"
                className="w-full px-3.5 py-2.5 pr-10 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {form.password && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all ${
                        i <= passwordStrength ? strengthColor : 'bg-zinc-800'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-[11px] ${passwordStrength >= 3 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {strengthLabel}
                </p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Confirm Password <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Re-enter your password"
                className="w-full px-3.5 py-2.5 pr-10 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              {form.confirmPassword && form.password && (
                <div className="absolute right-9 top-1/2 -translate-y-1/2">
                  {form.password === form.confirmPassword ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 space-y-3">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Initializing…</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Create Admin Account</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep('welcome')}
              className="w-full py-2 text-zinc-500 hover:text-zinc-300 text-xs transition-colors cursor-pointer"
            >
              ← Back
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
