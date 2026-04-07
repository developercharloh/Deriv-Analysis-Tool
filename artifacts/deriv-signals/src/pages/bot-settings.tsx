import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Bot, Save, Loader2 } from "lucide-react";

const BOT_OPTIONS = [
  { value: "Mr Risk Management Doctor🔥",  label: "Mr Risk Management Doctor🔥" },
  { value: "Even Odd bot🔥🔥",              label: "Even Odd bot🔥🔥" },
  { value: "Elite Entry Scanner Bot 🔥🔥", label: "Elite Entry Scanner Bot 🔥🔥" },
  { value: "Builder",                       label: "Builder" },
  { value: "Elite Default Speed Bot⚡⚡🤖",  label: "Elite Default Speed Bot⚡⚡🤖" },
  { value: "Matches Bot",                   label: "Matches Bot" },
];

const SIGNAL_TYPES = [
  { type: "OVER",    label: "Over",    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  { type: "UNDER",   label: "Under",   color: "text-red-400 bg-red-400/10 border-red-400/20" },
  { type: "RISE",    label: "Rise",    color: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
  { type: "FALL",    label: "Fall",    color: "text-orange-400 bg-orange-400/10 border-orange-400/20" },
  { type: "EVEN",    label: "Even",    color: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
  { type: "ODD",     label: "Odd",     color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  { type: "MATCHES", label: "Matches", color: "text-teal-400 bg-teal-400/10 border-teal-400/20" },
  { type: "DIFFERS", label: "Differs", color: "text-rose-400 bg-rose-400/10 border-rose-400/20" },
];

export function BotSettings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMutation = useUpdateSettings();
  const { toast } = useToast();

  const [signalTypeBots, setSignalTypeBots] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      setSignalTypeBots((settings as any).marketBots ?? {});
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ data: { marketBots: signalTypeBots } });
      toast({ title: "Bot Settings Saved", description: "Signal type bot assignments have been updated." });
    } catch {
      toast({ title: "Error", description: "Failed to save bot settings.", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Bot Settings</h1>
            <p className="text-muted-foreground mt-1">
              Choose which bot to recommend for each signal type — applies across all markets.
            </p>
          </div>
          <Button onClick={handleSave} disabled={updateMutation.isPending || isLoading} className="gap-2">
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </Button>
        </div>

        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-teal-400" />
              Bot per Signal Type
            </CardTitle>
            <CardDescription>
              Select the recommended bot for each signal type. The chosen bot name will appear in
              every signal of that type regardless of market. Select "None" to omit the bot line.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {SIGNAL_TYPES.map(({ type, label, color }) => (
                  <div key={type} className="space-y-3">
                    <span className={`inline-block font-mono text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}>
                      {label}
                    </span>
                    <Select
                      value={signalTypeBots[type] ?? "__none__"}
                      onValueChange={(val) =>
                        setSignalTypeBots((prev) => ({
                          ...prev,
                          [type]: val === "__none__" ? "" : val,
                        }))
                      }
                    >
                      <SelectTrigger className="w-full text-sm">
                        <SelectValue placeholder="Select a bot…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {BOT_OPTIONS.map((bot) => (
                          <SelectItem key={bot.value} value={bot.value}>
                            {bot.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
