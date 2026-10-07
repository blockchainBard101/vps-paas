'use client';

import React, { useState, useEffect } from 'react';
import {
  Globe,
  Server,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Network,
} from 'lucide-react';
import {
  fetchDomainStatus,
  fetchSystemSettings,
  updateSystemSettings,
  verifyHost,
} from '@/lib/api';

interface OnboardingDomainScreenProps {
  instanceName: string;
  onDone: () => void;
}

/**
 * Post-signup onboarding step: point a base domain + wildcard at this server so
 * deployed services get public hostnames (e.g. <service>.yourdomain.com).
 */
export function OnboardingDomainScreen({ instanceName, onDone }: OnboardingDomainScreenProps) {
  const [serverIp, setServerIp] = useState('');
  const [baseDomain, setBaseDomain] = useState('');
  const [wildcard, setWildcard] = useState('');
  const [wildcardTouched, setWildcardTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<null | { verified: boolean; ips: string[] }>(null);
  const [pendingWarning, setPendingWarning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDomainStatus()
      .then((s) => setServerIp(s.serverIp || ''))
      .catch(() => {});
  }, []);

  // Auto-fill the wildcard as *.baseDomain until the user edits it manually.
  useEffect(() => {
    if (!wildcardTouched && baseDomain) {
      const clean = baseDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '');
      setWildcard(`*.${clean}`);
    }
  }, [baseDomain, wildcardTouched]);

  const cleanBase = baseDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  function copyIp() {
    try {
      navigator.clipboard.writeText(serverIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function handleVerify() {
    if (!cleanBase) return;
    setIsVerifying(true);
    setVerifyResult(null);
    setError('');
    try {
      const res = await verifyHost(cleanBase);
      setVerifyResult({ verified: res.verified, ips: res.ips });
    } catch (e: any) {
      setError(e?.message || 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  }

  async function doSave() {
    setIsSaving(true);
    setError('');
    try {
      const current = await fetchSystemSettings();
      await updateSystemSettings({
        domains: {
          ...current.domains,
          serverDomain: cleanBase,
          wildcardDomain: wildcard.trim(),
        },
      });
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not save. You can configure this later in Settings → Domains.');
    } finally {
      setIsSaving(false);
    }
  }

  // Saving also verifies the base domain first. If it isn't pointing here yet we
  // don't block — we warn and let the user continue (it's saved as 'pending' and
  // the background verifier flips it once DNS propagates).
  async function handleSave() {
    setPendingWarning(false);
    if (!cleanBase) {
      onDone();
      return;
    }
    setIsVerifying(true);
    setError('');
    let verified = false;
    try {
      const res = await verifyHost(cleanBase);
      verified = res.verified;
      setVerifyResult({ verified: res.verified, ips: res.ips });
    } catch {}
    setIsVerifying(false);

    if (verified) {
      await doSave();
    } else {
      setPendingWarning(true);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 font-sans">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[120px]" />
      </div>
      <div className="relative z-10 max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-600/40 mx-auto">
            <Globe className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Connect your domain</h1>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Give <span className="text-indigo-400 font-medium">{instanceName}</span> a public home. Point your DNS at this
            server and every service you deploy gets its own <code className="text-indigo-300 font-mono">subdomain</code>.
          </p>
        </div>

        {/* Server IP card */}
        <div className="p-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <Network className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-indigo-300 font-mono font-semibold">
                  Server IP · point your domain here
                </div>
                <div className="font-mono text-lg font-semibold text-zinc-100 mt-0.5">
                  {serverIp || 'detecting…'}
                </div>
              </div>
            </div>
            {serverIp && (
              <button
                onClick={copyIp}
                className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
        </div>
        {/* Domain inputs */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Base Domain</label>
            <input
              type="text"
              value={baseDomain}
              onChange={(e) => setBaseDomain(e.target.value)}
              placeholder="yourdomain.com"
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[11px] text-zinc-500 mt-1.5">
              The root domain you own. Used for the dashboard and service subdomains.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Wildcard Subdomain</label>
            <input
              type="text"
              value={wildcard}
              onChange={(e) => {
                setWildcard(e.target.value);
                setWildcardTouched(true);
              }}
              placeholder="*.yourdomain.com"
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[11px] text-zinc-500 mt-1.5">
              Lets any deployed service resolve instantly, e.g. <code className="text-indigo-300">myapp.yourdomain.com</code>.
            </p>
          </div>

          {serverIp && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden font-mono text-xs">
              <div className="grid grid-cols-3 px-3.5 py-2 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                <span>Type</span>
                <span>Name</span>
                <span>Value</span>
              </div>
              <div className="grid grid-cols-3 px-3.5 py-2 text-zinc-300 border-b border-zinc-900">
                <span className="text-emerald-400">A</span>
                <span>@</span>
                <span className="text-indigo-300">{serverIp}</span>
              </div>
              <div className="grid grid-cols-3 px-3.5 py-2 text-zinc-300">
                <span className="text-emerald-400">A</span>
                <span>*</span>
                <span className="text-indigo-300">{serverIp}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || !cleanBase}
              className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>Verify DNS</span>
            </button>
            {verifyResult && (
              <span
                className={`text-[11px] font-mono flex items-center gap-1.5 ${
                  verifyResult.verified ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {verifyResult.verified ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Points to this server
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    {verifyResult.ips.length ? `Points to ${verifyResult.ips.join(', ')}` : 'No DNS records yet'}
                  </>
                )}
              </span>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Pending warning (soft gate) */}
        {pendingWarning && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] font-mono text-amber-200/90 leading-relaxed">
              <div className="font-semibold text-amber-200 mb-0.5">
                DNS for {cleanBase} isn&apos;t pointing here yet
              </div>
              {verifyResult && verifyResult.ips.length > 0 ? (
                <>It currently resolves to {verifyResult.ips.join(', ')}. </>
              ) : (
                <>No DNS records were found yet. </>
              )}
              You can continue — the domain is saved as{' '}
              <span className="text-amber-100 font-semibold">pending</span> and re-checked automatically once it
              propagates.
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2.5 text-zinc-500 hover:text-zinc-300 text-xs transition-colors cursor-pointer"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={pendingWarning ? doSave : handleSave}
            disabled={isSaving || isVerifying}
            className={`px-5 py-2.5 disabled:opacity-60 text-white font-semibold rounded-xl text-sm flex items-center gap-2 shadow-lg transition-all cursor-pointer ${
              pendingWarning
                ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
            }`}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Saving…
              </>
            ) : isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
              </>
            ) : pendingWarning ? (
              <>
                Continue anyway <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <Server className="w-4 h-4" /> Save &amp; Go to Dashboard <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
