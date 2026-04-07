import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { InstallTab } from "@/components/layout/install-tab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetSettings, useUpdateSettings, useTestTelegram } from "@workspace/api-client-react";
import { useForm, Controller } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Save, Settings2, Power, MessageCircle, QrCode, RefreshCw, CheckCircle2, WifiOff, Link, Bell, BellOff, Clock, Timer } from "lucide-react";

const MARKETS = [
  { symbol: "R_10",   name: "Volatility 10 Index" },
  { symbol: "R_25",   name: "Volatility 25 Index" },
  { symbol: "R_50",   name: "Volatility 50 Index" },
  { symbol: "R_75",   name: "Volatility 75 Index" },
  { symbol: "R_100",  name: "Volatility 100 Index" },
  { symbol: "RDBULL", name: "Bull Market Index" },
  { symbol: "RDBEAR", name: "Bear Market Index" },
  { symbol: "stpRNG", name: "Step Index" },
  { symbol: "JD10",   name: "Jump 10 Index" },
  { symbol: "JD25",   name: "Jump 25 Index" },
  { symbol: "JD50",   name: "Jump 50 Index" },
  { symbol: "JD75",   name: "Jump 75 Index" },
  { symbol: "JD100",  name: "Jump 100 Index" },
];
const SIGNAL_TYPES = ["OVER", "UNDER", "EVEN", "ODD", "RISE", "FALL", "MATCHES", "DIFFERS"];

type WAStatus = "disconnected" | "awaiting_qr" | "connected";

export function Settings() {
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const updateMutation = useUpdateSettings();
  const testTelegramMutation = useTestTelegram();
  const { toast } = useToast();

  // WhatsApp state
  const [waStatus, setWaStatus] = useState<WAStatus>("disconnected");
  const [waQR, setWaQR] = useState<string | null>(null);
  const [waEnabled, setWaEnabled] = useState(false);
  const [waTargetJids, setWaTargetJids] = useState("");
  const [waInviteLink, setWaInviteLink] = useState("");
  const [waSaving, setWaSaving] = useState(false);
  const [waTesting, setWaTesting] = useState(false);
  const [waRefreshing, setWaRefreshing] = useState(false);
  const [waResolving, setWaResolving] = useState(false);

  // Poll WhatsApp status every 3s
  const pollWaStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const data = await res.json();
      setWaStatus(data.status);
      setWaQR(data.qr || null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    pollWaStatus();
    const iv = setInterval(pollWaStatus, 3000);
    return () => clearInterval(iv);
  }, [pollWaStatus]);

  // Load WhatsApp settings from server settings when available
  useEffect(() => {
    if (settings) {
      setWaEnabled((settings as any).whatsappEnabled ?? false);
      setWaTargetJids((settings as any).whatsappTargetJids ?? "");
    }
  }, [settings]);

  const handleSaveWhatsApp = async () => {
    setWaSaving(true);
    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappEnabled: waEnabled, whatsappTargetJids: waTargetJids }),
      });
      const data = await res.json();
      toast({ title: data.success ? "Saved" : "Error", description: data.message, variant: data.success ? "default" : "destructive" });
    } catch {
      toast({ title: "Error", description: "Failed to save WhatsApp settings.", variant: "destructive" });
    } finally { setWaSaving(false); }
  };

  const handleTestWhatsApp = async () => {
    setWaTesting(true);
    try {
      const res = await fetch("/api/whatsapp/test", { method: "POST" });
      const data = await res.json();
      toast({ title: data.success ? "Test Sent!" : "Failed", description: data.message || `Sent to ${data.sent} chat(s).`, variant: data.success ? "default" : "destructive" });
    } catch {
      toast({ title: "Error", description: "Test failed.", variant: "destructive" });
    } finally { setWaTesting(false); }
  };

  const handleRefreshQR = async () => {
    setWaRefreshing(true);
    try {
      await fetch("/api/whatsapp/refresh-qr", { method: "POST" });
      toast({ title: "QR refreshed", description: "New QR code is generating, scan it with WhatsApp." });
    } catch {
      toast({ title: "Error", description: "Failed to refresh QR.", variant: "destructive" });
    } finally { setTimeout(() => setWaRefreshing(false), 2000); }
  };

  const handleResolveGroup = async () => {
    if (!waInviteLink.trim()) return;
    setWaResolving(true);
    try {
      const res = await fetch("/api/whatsapp/resolve-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteLink: waInviteLink.trim() }),
      });
      const data = await res.json();
      if (data.success && data.jid) {
        const existing = waTargetJids.split(",").map(s => s.trim()).filter(Boolean);
        if (!existing.includes(data.jid)) {
          setWaTargetJids([...existing, data.jid].join(", "));
        }
        setWaInviteLink("");
        toast({ title: "Group Added", description: `JID: ${data.jid}` });
      } else {
        toast({ title: "Failed", description: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to resolve invite link.", variant: "destructive" });
    } finally { setWaResolving(false); }
  };

  const { control, handleSubmit, reset, watch } = useForm({
    defaultValues: {
      telegramBotToken: "",
      telegramChatId: "",
      enableTelegram: false,
      selectedMarkets: [] as string[],
      signalTypes: [] as string[],
      minConfidence: "MEDIUM",
      isRunning: false,
      signalIntervalMinutes: 20,
      preAlertEnabled: true,
      preAlertMinutes: 2,
    }
  });

  const isRunning = watch("isRunning");
  const enableTelegram = watch("enableTelegram");
  const preAlertEnabled = watch("preAlertEnabled");

  useEffect(() => {
    if (settings) {
      reset({
        telegramBotToken: settings.telegramBotToken || "",
        telegramChatId: settings.telegramChatId || "",
        enableTelegram: settings.enableTelegram,
        selectedMarkets: settings.selectedMarkets,
        signalTypes: settings.signalTypes,
        minConfidence: settings.minConfidence,
        isRunning: settings.isRunning,
        signalIntervalMinutes: (settings as any).signalIntervalMinutes ?? 20,
        preAlertEnabled: (settings as any).preAlertEnabled !== false,
        preAlertMinutes: (settings as any).preAlertMinutes ?? 2,
      });
    }
  }, [settings, reset]);

  const onSubmit = async (data: any) => {
    try {
      await updateMutation.mutateAsync({ data });
      toast({
        title: "Settings Saved",
        description: "Your bot configuration has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings.",
        variant: "destructive"
      });
    }
  };

  const handleTestTelegram = async () => {
    try {
      const res = await testTelegramMutation.mutateAsync();
      toast({
        title: res.success ? "Success" : "Failed",
        description: res.message,
        variant: res.success ? "default" : "destructive"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send test message.",
        variant: "destructive"
      });
    }
  };

  if (loadingSettings) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Bot Configuration</h1>
          <p className="text-muted-foreground">Manage your trading strategy, markets, and alerts.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <Controller
            name="isRunning"
            control={control}
            render={({ field }) => (
              <div className="flex items-center gap-3 bg-card px-4 py-2 rounded-xl border border-white/5 shadow-lg">
                <Label htmlFor="power" className="font-bold cursor-pointer flex items-center gap-2">
                  <Power className={`w-4 h-4 ${field.value ? 'text-success' : 'text-muted-foreground'}`} />
                  {field.value ? 'BOT ACTIVE' : 'BOT STOPPED'}
                </Label>
                <Switch 
                  id="power" 
                  checked={field.value} 
                  onCheckedChange={(val) => {
                    field.onChange(val);
                    handleSubmit(onSubmit)();
                  }} 
                />
              </div>
            )}
          />
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Strategy Settings */}
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-primary" />
                Strategy Rules
              </CardTitle>
              <CardDescription>Configure which signals to generate.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              
              <div className="space-y-4">
                <Label className="text-base text-white">Monitored Markets</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {MARKETS.map(({ symbol, name }) => (
                    <Controller
                      key={symbol}
                      name="selectedMarkets"
                      control={control}
                      render={({ field }) => {
                        const isChecked = field.value.includes(symbol);
                        return (
                          <Label 
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                              isChecked ? 'bg-primary/10 border-primary/50 text-white' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'
                            }`}
                          >
                            <Checkbox 
                              checked={isChecked}
                              onCheckedChange={(checked) => {
                                const newValues = checked 
                                  ? [...field.value, symbol]
                                  : field.value.filter((v: string) => v !== symbol);
                                field.onChange(newValues);
                              }}
                            />
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium leading-none">{name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">{symbol}</span>
                            </div>
                          </Label>
                        )
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <Label className="text-base text-white">Signal Types</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {SIGNAL_TYPES.map(type => (
                    <Controller
                      key={type}
                      name="signalTypes"
                      control={control}
                      render={({ field }) => {
                        const isChecked = field.value.includes(type);
                        return (
                          <Label 
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                              isChecked ? 'bg-accent/10 border-accent/50 text-white' : 'bg-black/20 border-white/5 text-muted-foreground hover:bg-white/5'
                            }`}
                          >
                            <Checkbox 
                              checked={isChecked}
                              onCheckedChange={(checked) => {
                                const newValues = checked 
                                  ? [...field.value, type]
                                  : field.value.filter((v: string) => v !== type);
                                field.onChange(newValues);
                              }}
                            />
                            <span className="font-bold text-sm tracking-wide">{type}</span>
                          </Label>
                        )
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <Label className="text-base text-white">Minimum Confidence Required</Label>
                <Controller
                  name="minConfidence"
                  control={control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select confidence level" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low (More signals, higher risk)</SelectItem>
                        <SelectItem value="MEDIUM">Medium (Balanced)</SelectItem>
                        <SelectItem value="HIGH">High (Fewer signals, safer)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

            </CardContent>
          </Card>

          {/* Telegram Settings */}
          <Card className="glass-panel h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-sky-400" />
                Telegram Delivery
              </CardTitle>
              <CardDescription>Setup automated alerts to your channel.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
                <div>
                  <Label htmlFor="telegram-toggle" className="text-base text-white cursor-pointer">Enable Alerts</Label>
                  <p className="text-sm text-muted-foreground mt-1">Send generated signals instantly.</p>
                </div>
                <Controller
                  name="enableTelegram"
                  control={control}
                  render={({ field }) => (
                    <Switch id="telegram-toggle" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>

              <div className={`space-y-6 transition-opacity duration-300 ${!enableTelegram ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="space-y-2">
                  <Label htmlFor="botToken">Bot Token</Label>
                  <Controller
                    name="telegramBotToken"
                    control={control}
                    render={({ field }) => (
                      <Input id="botToken" type="password" placeholder="123456789:ABCdefGHIjkl..." {...field} />
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="chatId">Chat ID / Channel Name</Label>
                  <Controller
                    name="telegramChatId"
                    control={control}
                    render={({ field }) => (
                      <Input id="chatId" placeholder="-1001234567890 or @mychannel" {...field} />
                    )}
                  />
                </div>

                <Button 
                  type="button" 
                  variant="secondary" 
                  className="w-full"
                  onClick={handleTestTelegram}
                  disabled={!enableTelegram || testTelegramMutation.isPending}
                >
                  {testTelegramMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Send Test Message
                </Button>
              </div>

            </CardContent>
          </Card>
        </div>

        {/* Signal Control Panel */}
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-400" />
              Signal Control
            </CardTitle>
            <CardDescription>Configure how often signals are sent and whether a pre-alert warning is issued beforehand.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Signal Interval */}
              <div className="space-y-3">
                <Label className="text-base text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Signal Interval
                </Label>
                <p className="text-xs text-muted-foreground">How many minutes between each signal dispatch.</p>
                <div className="flex items-center gap-3">
                  <Controller
                    name="signalIntervalMinutes"
                    control={control}
                    render={({ field }) => (
                      <Input
                        type="number"
                        min={5}
                        max={240}
                        className="w-28 text-center font-mono text-lg"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    )}
                  />
                  <span className="text-muted-foreground text-sm">minutes</span>
                </div>
              </div>

              {/* Pre-Alert Settings */}
              <div className="space-y-3">
                <Label className="text-base text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" />
                  Pre-Alert Warning
                </Label>
                <p className="text-xs text-muted-foreground">Send a heads-up message before the signal drops.</p>

                <div className="flex items-center gap-4 p-3 bg-black/30 rounded-xl border border-white/5">
                  <Controller
                    name="preAlertEnabled"
                    control={control}
                    render={({ field }) => (
                      <div className="flex items-center gap-3 w-full">
                        {field.value
                          ? <Bell className="w-4 h-4 text-green-400 shrink-0" />
                          : <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <span className={`text-sm font-medium flex-1 ${field.value ? "text-white" : "text-muted-foreground"}`}>
                          {field.value ? "Pre-alert enabled" : "Pre-alert disabled"}
                        </span>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </div>
                    )}
                  />
                </div>

                <div className={`flex items-center gap-3 transition-opacity duration-200 ${!preAlertEnabled ? "opacity-40 pointer-events-none" : ""}`}>
                  <Controller
                    name="preAlertMinutes"
                    control={control}
                    render={({ field }) => (
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        className="w-20 text-center font-mono text-lg"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        disabled={!preAlertEnabled}
                      />
                    )}
                  />
                  <span className="text-muted-foreground text-sm">minutes before signal</span>
                </div>
              </div>

            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end pt-4">
          <Button type="submit" size="lg" disabled={updateMutation.isPending} className="w-full md:w-auto md:min-w-[200px]">
            {updateMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
            Save Configuration
          </Button>
        </div>
      </form>

      {/* WhatsApp Integration Card */}
      <Card className="glass-panel mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-400" />
            WhatsApp Delivery
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold ${
              waStatus === "connected" ? "bg-green-500/20 text-green-400" :
              waStatus === "awaiting_qr" ? "bg-yellow-500/20 text-yellow-400" :
              "bg-white/10 text-muted-foreground"
            }`}>
              {waStatus === "connected" ? "Connected" : waStatus === "awaiting_qr" ? "Scan QR" : "Disconnected"}
            </span>
          </CardTitle>
          <CardDescription>Mirror every signal to your WhatsApp personal chat and trading groups simultaneously.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Enable toggle */}
          <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
            <div>
              <Label className="text-base text-white cursor-pointer">Enable WhatsApp Alerts</Label>
              <p className="text-sm text-muted-foreground mt-1">Send all signals to WhatsApp alongside Telegram.</p>
            </div>
            <Switch checked={waEnabled} onCheckedChange={setWaEnabled} />
          </div>

          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 transition-opacity duration-300 ${!waEnabled ? 'opacity-50 pointer-events-none' : ''}`}>

            {/* QR Code / Connection status */}
            <div className="space-y-3">
              <Label className="text-base text-white">WhatsApp Connection</Label>
              {waStatus === "connected" ? (
                <div className="flex flex-col items-center gap-3 p-6 bg-green-500/10 border border-green-500/30 rounded-xl">
                  <CheckCircle2 className="w-12 h-12 text-green-400" />
                  <p className="text-green-400 font-semibold">WhatsApp Connected</p>
                  <p className="text-sm text-muted-foreground text-center">Signals are mirroring to WhatsApp. You can send a test message to verify.</p>
                  <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={waRefreshing} className="mt-2">
                    {waRefreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Disconnect & Re-scan
                  </Button>
                </div>
              ) : waStatus === "awaiting_qr" && waQR ? (
                <div className="flex flex-col items-center gap-3 p-4 bg-black/40 border border-yellow-500/30 rounded-xl">
                  <p className="text-yellow-400 text-sm font-semibold flex items-center gap-2">
                    <QrCode className="w-4 h-4" /> Scan with WhatsApp on your phone
                  </p>
                  <img src={waQR} alt="WhatsApp QR Code" className="w-56 h-56 rounded-xl" />
                  <p className="text-xs text-muted-foreground text-center">Open WhatsApp → Linked Devices → Link a Device → Scan</p>
                  <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={waRefreshing}>
                    {waRefreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    New QR Code
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 p-6 bg-black/40 border border-white/10 rounded-xl">
                  <WifiOff className="w-10 h-10 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm text-center">Not connected. Enable WhatsApp alerts and a QR code will appear here.</p>
                  <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={waRefreshing}>
                    {waRefreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                    Generate QR Code
                  </Button>
                </div>
              )}
            </div>

            {/* Targets */}
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-base text-white">Target JIDs</Label>
                <p className="text-xs text-muted-foreground">Your personal number or group JIDs (comma-separated). Format: <span className="font-mono">2547XXXXXXXX@s.whatsapp.net</span> for personal, <span className="font-mono">12036...@g.us</span> for groups.</p>
                <textarea
                  className="w-full min-h-[90px] bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="2547XXXXXXXX@s.whatsapp.net, 120363XXXXXXXX@g.us"
                  value={waTargetJids}
                  onChange={(e) => setWaTargetJids(e.target.value)}
                />
              </div>

              {/* Resolve group invite link */}
              <div className="space-y-2">
                <Label className="text-sm text-white">Add Group via Invite Link</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://chat.whatsapp.com/..."
                    value={waInviteLink}
                    onChange={(e) => setWaInviteLink(e.target.value)}
                    disabled={waStatus !== "connected"}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleResolveGroup}
                    disabled={!waInviteLink.trim() || waStatus !== "connected" || waResolving}
                  >
                    {waResolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Must be connected to resolve a group link. The JID is automatically added above.</p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="secondary" className="flex-1" onClick={handleTestWhatsApp} disabled={waStatus !== "connected" || waTesting}>
                  {waTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Test Message
                </Button>
                <Button className="flex-1" onClick={handleSaveWhatsApp} disabled={waSaving}>
                  {waSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save
                </Button>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      <InstallTab />
    </AppLayout>
  );
}
