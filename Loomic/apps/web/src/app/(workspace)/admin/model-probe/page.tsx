"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchAdminModelCallProbe } from "@/lib/server-api";

type Probe = Awaited<ReturnType<typeof fetchAdminModelCallProbe>>;
type ModelProbe = Probe["models"][number];

function statusClass(model: ModelProbe) {
  if (model.callable) return "border-emerald-500/25 bg-emerald-500/5";
  return "border-amber-500/25 bg-amber-500/5";
}

export default function ModelProbePage() {
  const { session } = useAuth();
  const [data, setData] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminModelCallProbe(session.access_token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load model probe.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  const callable = useMemo(() => data?.models.filter((model) => model.callable).length ?? 0, [data]);
  const duplicates = useMemo(() => data?.models.filter((model) => model.duplicateMappings > 1).length ?? 0, [data]);

  return <section className="mx-auto max-w-7xl space-y-6 p-6 md:p-10">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">AI control</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Model call probe</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Configuration-only verification. This page does not call Providers, create jobs, upload images, or consume credits.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</button>
    </header>
    {error ? <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-border/50 bg-card p-4"><p className="text-xs text-muted-foreground">Callable by configuration</p><p className="mt-2 text-2xl font-semibold">{callable} / {data?.models.length ?? 0}</p></div>
      <div className="rounded-2xl border border-border/50 bg-card p-4"><p className="text-xs text-muted-foreground">Duplicate model mappings</p><p className="mt-2 text-2xl font-semibold">{duplicates}</p></div>
      <div className="rounded-2xl border border-border/50 bg-card p-4"><p className="text-xs text-muted-foreground">Verification mode</p><p className="mt-2 text-sm font-semibold">{data?.mode ?? "configuration_only"}</p></div>
    </div>
    {loading ? <div className="h-64 animate-pulse rounded-2xl bg-muted/60" /> : <div className="space-y-3">
      {data?.models.map((model) => <article key={`${model.providerLabel}:${model.modelId}`} className={`rounded-2xl border p-5 ${statusClass(model)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><h2 className="font-semibold">{model.modelId}</h2><span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px]">{model.mediaType}</span></div><p className="mt-1 text-xs text-muted-foreground">{model.providerLabel} · {model.family} · {model.requestPreview.adapter}</p></div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold">{model.callable ? <><ShieldCheck className="size-3.5" />Callable</> : <><TriangleAlert className="size-3.5" />Needs attention</>}</span>
        </div>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-muted-foreground">Input image</p><p className="mt-1 font-medium">{model.inputImageStatus}</p></div>
          <div><p className="text-muted-foreground">Resolution</p><p className="mt-1 font-medium">{model.resolution ?? "Provider default"}</p></div>
          <div><p className="text-muted-foreground">Response contract</p><p className="mt-1 font-medium">task {model.responseContract.taskId ? "yes" : "no"} · video {model.responseContract.videoUrl ? "yes" : "no"} · image {model.responseContract.imageUrl ? "yes" : "no"}</p></div>
          <div><p className="text-muted-foreground">Required fields</p><p className="mt-1 font-medium">{model.requestPreview.requiredFields.join(", ") || "none"}</p></div>
        </div>
        {model.warnings.length > 0 ? <div className="mt-4 flex flex-wrap gap-2">{model.warnings.map((warning) => <span key={warning} className="rounded-full border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-800">{warning}</span>)}</div> : <p className="mt-4 text-xs text-emerald-700">No contract warnings.</p>}
      </article>)}
    </div>}
    <p className="text-xs text-muted-foreground">Last checked: {data?.checkedAt ? new Date(data.checkedAt).toLocaleString() : "Not checked"}. “Callable” describes local configuration and health state only; it is not proof that an upstream request succeeded.</p>
  </section>;
}
