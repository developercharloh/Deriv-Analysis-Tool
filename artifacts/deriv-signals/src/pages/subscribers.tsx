import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  UserPlus,
  Copy,
  Check,
  Smartphone,
  ShieldOff,
  KeyRound,
  RotateCcw,
  Loader2,
  Users,
  Link,
  Sparkles,
  Globe,
  Clock,
  Monitor,
  Trash2,
  AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

type Tier = "weekly" | "monthly" | "6months" | "yearly";
type Status = "active" | "expired" | "suspended";

interface Subscriber {
  id: number;
  name: string;
  tier: Tier;
  status: Status;
  endDate: string;
  accessKey: string | null;
  activeDevices: number;
}

const TIER_LABELS: Record<Tier, string> = {
  weekly: "Weekly · 7 days",
  monthly: "Monthly · 30 days",
  "6months": "6 Months · 180 days",
  yearly: "Yearly · 365 days",
};

const TIER_SHORT: Record<Tier, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  "6months": "6 Months",
  yearly: "Yearly",
};

const TIER_COLORS: Record<Tier, string> = {
  weekly: "border-sky-500/30 text-sky-400 bg-sky-500/10",
  monthly: "border-violet-500/30 text-violet-400 bg-violet-500/10",
  "6months": "border-pink-500/30 text-pink-400 bg-pink-500/10",
  yearly: "border-amber-500/30 text-amber-400 bg-amber-500/10",
};

const STATUS_COLORS: Record<Status, string> = {
  active: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  expired: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  suspended: "border-red-500/30 text-red-400 bg-red-500/10",
};

function daysRemaining(endDate: string) {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000));
}

// ── Session interface ────────────────────────────────────────────────────────

interface Session {
  id: number;
  deviceId: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastSeen: string;
  createdAt: string;
}

// ── Devices dialog ───────────────────────────────────────────────────────────

function DevicesDialog({ sub }: { sub: Subscriber }) {
  const [open, setOpen] = useState(false);

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: [`/api/subscribers/${sub.id}/sessions`],
    queryFn: () => apiFetch(`/subscribers/${sub.id}/sessions`),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  const deviceCount = sub.activeDevices ?? 0;
  const isFull = deviceCount >= 2;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          title="View connected devices"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer"
          style={{
            background: isFull ? "rgba(255,79,163,0.10)" : "rgba(14,165,233,0.08)",
            border: `1px solid ${isFull ? "rgba(255,79,163,0.25)" : "rgba(14,165,233,0.18)"}`,
            color: isFull ? "#FF4FA3" : "#38bdf8",
          }}>
          <Smartphone className="w-3 h-3" />
          {deviceCount}/2
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Monitor className="w-4 h-4" style={{ color: "#38bdf8" }} />
            Connected Devices — {sub.name}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No active sessions</div>
          ) : (
            sessions.map((s, i) => (
              <div key={s.id} className="rounded-xl p-4 space-y-2.5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.20)" }}>
                    <Smartphone className="w-3.5 h-3.5" style={{ color: "#38bdf8" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      Device {i + 1}{s.deviceName ? ` — ${s.deviceName}` : ""}
                    </p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" title="Online" />
                </div>

                <div className="space-y-1.5 pl-9">
                  {s.ipAddress && (
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: "#6b84a8" }}>
                      <Globe className="w-3 h-3 flex-shrink-0" style={{ color: "#38bdf8" }} />
                      <span className="font-mono">{s.ipAddress}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: "#6b84a8" }}>
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span>Last seen {formatDistanceToNow(new Date(s.lastSeen), { addSuffix: true })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: "#6b84a8" }}>
                    <span className="text-[10px] uppercase tracking-wide">First login:</span>
                    <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))
          )}

          <p className="text-[11px] text-center" style={{ color: "#4a607a" }}>
            Updates every 10 seconds · Max 2 devices per subscription
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Copy button ─────────────────────────────────────────────────────────────

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1800); });
  }
  return (
    <button onClick={copy} title={`Copy ${label ?? ""}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap"
      style={{ background: ok ? "rgba(52,211,153,0.12)" : "rgba(14,165,233,0.10)", border: `1px solid ${ok ? "rgba(52,211,153,0.30)" : "rgba(14,165,233,0.20)"}`, color: ok ? "#34d399" : "#38bdf8" }}>
      {ok ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {label}
    </button>
  );
}

// ── Renew dialog ─────────────────────────────────────────────────────────────

function RenewDialog({ sub, onSuccess }: { sub: Subscriber; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<Tier>(sub.tier);
  const { toast } = useToast();
  const renew = useMutation({
    mutationFn: () => apiFetch(`/subscribers/${sub.id}/renew`, { method: "POST", body: JSON.stringify({ tier }) }),
    onSuccess: () => {
      toast({ title: `${sub.name} renewed on ${TIER_SHORT[tier]} plan` });
      onSuccess();
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
          style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.20)", color: "#38bdf8" }}>
          <RotateCcw className="w-3 h-3" /> Renew
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Renew — {sub.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
            <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(TIER_LABELS) as [Tier, string][]).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Extends from current expiry if still active.</p>
          <Button className="w-full" onClick={() => renew.mutate()} disabled={renew.isPending}>
            {renew.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Renewing…</> : "Confirm Renewal"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete dialog ─────────────────────────────────────────────────────────────

function DeleteDialog({ sub, onSuccess }: { sub: Subscriber; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { toast } = useToast();

  const del = useMutation({
    mutationFn: () => apiFetch(`/subscribers/${sub.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: `${sub.name} deleted`, description: "All access and sessions permanently removed." });
      onSuccess();
      setOpen(false);
      setConfirm("");
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirm(""); }}>
      <DialogTrigger asChild>
        <button
          title="Permanently delete subscriber"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap"
          style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.22)", color: "#f87171" }}>
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            Delete Subscriber
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Warning box */}
          <div className="rounded-xl px-4 py-3 space-y-1"
            style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.22)" }}>
            <p className="text-sm font-semibold text-red-400">This action is permanent and cannot be undone.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Deleting <strong className="text-white">{sub.name}</strong> will permanently remove:
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 mt-1 ml-2">
              <li>• Their access key <span className="font-mono text-white/50">{sub.accessKey}</span></li>
              <li>• All active device sessions</li>
              <li>• Their full subscription record</li>
            </ul>
          </div>

          {/* Confirm by typing name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Type <span className="text-white font-mono">{sub.name}</span> to confirm
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={sub.name}
              className="w-full h-10 px-3 rounded-xl text-sm outline-none transition-all"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(244,63,94,0.25)",
                color: "#dce8f4",
              }}
              onFocus={(e) => { e.target.style.border = "1px solid rgba(244,63,94,0.55)"; }}
              onBlur={(e) => { e.target.style.border = "1px solid rgba(244,63,94,0.25)"; }}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setOpen(false); setConfirm(""); }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "#94a3b8" }}>
              Cancel
            </button>
            <button
              onClick={() => del.mutate()}
              disabled={confirm !== sub.name || del.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
              style={{
                background: confirm === sub.name ? "rgba(244,63,94,0.85)" : "rgba(244,63,94,0.15)",
                border: "1px solid rgba(244,63,94,0.40)",
                color: confirm === sub.name ? "#fff" : "#f87171",
                cursor: confirm === sub.name && !del.isPending ? "pointer" : "not-allowed",
              }}>
              {del.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
                : <><Trash2 className="w-3.5 h-3.5" /> Delete Forever</>}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add subscriber dialog ────────────────────────────────────────────────────

function AddSubscriberDialog({ onSuccess }: { onSuccess: (sub: Subscriber) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("monthly");
  const { toast } = useToast();

  const create = useMutation({
    mutationFn: () => apiFetch("/subscribers", { method: "POST", body: JSON.stringify({ name, tier }) }),
    onSuccess: (data: Subscriber) => {
      toast({ title: `${data.name} added`, description: `Key generated: ${data.accessKey}` });
      onSuccess(data);
      setName("");
      setTier("monthly");
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 border-0 font-semibold"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)", color: "#fff" }}>
          <UserPlus className="w-4 h-4" /> New Subscriber
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "#FF4FA3" }} />
            Add Subscriber
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full h-11 px-3 rounded-xl text-sm outline-none transition-all"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(14,165,233,0.20)", color: "#dce8f4" }}
              onFocus={(e) => { e.target.style.border = "1px solid rgba(14,165,233,0.50)"; }}
              onBlur={(e) => { e.target.style.border = "1px solid rgba(14,165,233,0.20)"; }}
            />
          </div>

          {/* Plan */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription Plan</label>
            <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
              <SelectTrigger className="h-11 bg-white/5 border-white/10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(TIER_LABELS) as [Tier, string][]).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
            style={{ background: "rgba(255,79,163,0.06)", border: "1px solid rgba(255,79,163,0.18)", color: "#c084fc" }}>
            <KeyRound className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#FF4FA3" }} />
            A unique access key will be generated automatically
          </div>

          <Button className="w-full h-11 font-semibold border-0"
            style={{ background: "linear-gradient(135deg,#0ea5e9,#a855f7,#FF4FA3)", color: "#fff" }}
            onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
            {create.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generating key…</>
              : <><Sparkles className="w-4 h-4 mr-2" />Generate Access Key</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function Subscribers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: subscribers = [], isLoading } = useQuery<Subscriber[]>({
    queryKey: ["/api/subscribers"],
    queryFn: () => apiFetch("/subscribers"),
    refetchInterval: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });

  const regenKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/subscribers/${id}/regenerate-key`, { method: "POST" }),
    onSuccess: (data: { accessKey: string }) => {
      navigator.clipboard.writeText(data.accessKey).catch(() => {});
      toast({ title: "New key generated & copied", description: data.accessKey });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => apiFetch(`/subscribers/${id}/revoke`, { method: "POST" }),
    onSuccess: (_: unknown, id: number) => {
      const sub = subscribers.find((s) => s.id === id);
      toast({ title: `${sub?.name ?? "Subscriber"} revoked`, description: "Access suspended and key reset." });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function copyLink(sub: Subscriber) {
    const url = `${window.location.origin}${BASE}/access?key=${encodeURIComponent(sub.accessKey ?? "")}`;
    navigator.clipboard.writeText(url).then(() =>
      toast({ title: "Link copied!", description: "Send this link to your subscriber" })
    );
  }

  const activeCount = subscribers.filter((s) => s.status === "active").length;
  const totalDevices = subscribers.reduce((acc, s) => acc + (s.activeDevices ?? 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-gradient">Subscribers</h1>
            <p className="text-muted-foreground mt-1">Generate and manage subscriber access keys</p>
          </div>
          <AddSubscriberDialog onSuccess={refresh} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Active", value: activeCount, color: "#34d399" },
            { label: "Total", value: subscribers.length, color: "#38bdf8" },
            { label: "Online Devices", value: totalDevices, color: "#FF4FA3" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-2xl px-5 py-4"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="text-2xl font-display font-black" style={{ color }}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : subscribers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.15)" }}>
                <Users className="w-5 h-5" style={{ color: "#38bdf8" }} />
              </div>
              <p className="text-sm text-muted-foreground">No subscribers yet — click <strong className="text-white">New Subscriber</strong> to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    {["Name", "Plan", "Access Key", "Status", "Devices", "Expires", "Actions"].map((h) => (
                      <th key={h} className="px-5 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((sub) => {
                    const days = daysRemaining(sub.endDate);
                    const isExpiring = sub.status === "active" && days <= 3;
                    const isRevoking = revoke.isPending && revoke.variables === sub.id;
                    const isRegen = regenKey.isPending && regenKey.variables === sub.id;

                    return (
                      <tr key={sub.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                        className="transition-colors hover:bg-white/[0.02]">

                        {/* Name */}
                        <td className="px-5 py-4">
                          <p className="font-semibold text-white">{sub.name}</p>
                        </td>

                        {/* Plan */}
                        <td className="px-5 py-4">
                          <Badge variant="outline" className={cn("text-xs font-semibold border whitespace-nowrap", TIER_COLORS[sub.tier])}>
                            {TIER_SHORT[sub.tier]}
                          </Badge>
                        </td>

                        {/* Access Key */}
                        <td className="px-5 py-4">
                          {sub.accessKey ? (
                            <div className="space-y-2">
                              <span className="font-mono text-[11px] tracking-wider block"
                                style={{ color: "#94d8fb" }}>{sub.accessKey}</span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <CopyBtn text={sub.accessKey} label="Key" />
                                <button onClick={() => copyLink(sub)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap"
                                  style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.22)", color: "#c084fc" }}>
                                  <Link className="w-3 h-3" /> Copy Link
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/50 italic">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          <Badge variant="outline" className={cn("text-xs font-semibold border capitalize", STATUS_COLORS[sub.status])}>
                            {sub.status}
                          </Badge>
                        </td>

                        {/* Devices */}
                        <td className="px-5 py-4">
                          <DevicesDialog sub={sub} />
                        </td>

                        {/* Expires */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className={cn("text-sm font-mono tabular-nums", isExpiring ? "text-amber-400 font-semibold" : "text-white/60")}>
                            {days === 0 ? "Today" : `${days}d`}
                          </p>
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Regen key */}
                            <button onClick={() => regenKey.mutate(sub.id)} disabled={isRegen}
                              title="Generate a new key — invalidates all active sessions"
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap"
                              style={{ background: "rgba(14,165,233,0.08)", border: "1px solid rgba(14,165,233,0.20)", color: "#38bdf8" }}>
                              {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                              New Key
                            </button>

                            {/* Renew */}
                            <RenewDialog sub={sub} onSuccess={refresh} />

                            {/* Revoke / Re-activate */}
                            {sub.status !== "suspended" ? (
                              <button
                                onClick={() => {
                                  if (confirm(`Revoke ${sub.name}? This suspends their account, clears all sessions, and resets the key.`)) {
                                    revoke.mutate(sub.id);
                                  }
                                }}
                                disabled={isRevoking}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap"
                                style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.20)", color: "#f87171" }}>
                                {isRevoking ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldOff className="w-3 h-3" />}
                                Revoke
                              </button>
                            ) : (
                              <RenewDialog sub={sub} onSuccess={refresh} />
                            )}

                            {/* Delete permanently */}
                            <DeleteDialog sub={sub} onSuccess={refresh} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info strip */}
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-xs"
          style={{ background: "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.12)", color: "#4a8aad" }}>
          <Smartphone className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#38bdf8" }} />
          <span>
            <strong className="text-sky-400">2-device limit per key.</strong> If a 3rd device tries to log in, all sessions are cleared and the key is automatically reset. Use <strong className="text-sky-400">New Key</strong> to manually issue a fresh key and force re-login on all devices.
          </span>
        </div>
      </div>
    </AppLayout>
  );
}
