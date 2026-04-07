import { AppLayout } from "@/components/layout/app-layout";
import { useGetSignals } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { getSignalColorInfo, formatPrice } from "@/lib/utils";
import { Loader2 } from "lucide-react";

function tradeLabel(signalType: string, predictionDigit?: number | null): string {
  if ((signalType === "OVER" || signalType === "UNDER") && predictionDigit != null) {
    return `${signalType} ${predictionDigit}`;
  }
  return signalType;
}

export function History() {
  const { data: signals, isLoading } = useGetSignals({ limit: 100 });

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-white mb-2">Signal History</h1>
        <p className="text-muted-foreground">Review past generated signals and their metrics.</p>
      </div>

      <div className="glass-panel rounded-2xl p-1">
        {isLoading ? (
          <div className="h-96 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead className="text-center">Pred. Digit</TableHead>
                <TableHead className="text-center">Entry Point</TableHead>
                <TableHead className="text-center">Last Digit</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals?.map((signal) => {
                const { color, bg } = getSignalColorInfo(signal.signalType);
                const label = tradeLabel(signal.signalType, signal.predictionDigit);
                return (
                  <TableRow key={signal.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(signal.createdAt), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-white text-sm">{signal.market}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{signal.symbol}</div>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wide ${bg} ${color}`}>
                        {label}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {signal.predictionDigit != null ? (
                        <span className={`font-mono font-bold text-base ${color}`}>
                          {signal.predictionDigit}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {signal.entryDigit != null ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 rounded-lg px-2 py-0.5">
                          <span className="font-mono font-bold text-emerald-400 text-base">{signal.entryDigit}</span>
                          <span className="text-sm">🟩</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`font-mono font-bold text-base ${color}`}>{signal.digit}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{formatPrice(signal.price, 4)}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="glass"
                        className={
                          signal.confidence === "HIGH" ? "text-emerald-400 border-emerald-400/30" :
                          signal.confidence === "MEDIUM" ? "text-yellow-400 border-yellow-400/30" :
                          "text-muted-foreground"
                        }
                      >
                        {signal.confidence}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!signals || signals.length === 0) && (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No signals found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </AppLayout>
  );
}
