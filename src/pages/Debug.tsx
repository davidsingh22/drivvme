import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

export default function Debug() {
  const [uid, setUid] = useState<string | null>(null);
  const [oneSignalId, setOneSignalId] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));

    // Try Median bridge first
    const median = (window as any).median;
    if (median?.onesignal?.info) {
      median.onesignal.info().then((info: any) => {
        const id = info?.oneSignalId || info?.subscriptionId || info?.id;
        if (id) {
          setOneSignalId(id);
          setSource("Median bridge");
          return;
        }
      }).catch(() => {});
    }

    // Fallback: OneSignal Web SDK
    (window as any).OneSignalDeferred = (window as any).OneSignalDeferred || [];
    (window as any).OneSignalDeferred.push((OneSignal: any) => {
      const id = OneSignal?.User?.PushSubscription?.id;
      if (id) {
        setOneSignalId((prev) => prev ?? id);
        setSource((prev) => prev || "Web SDK");
      }
    });
  }, []);

  const copyToClipboard = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const Row = ({ label, value }: { label: string; value: string | null }) => (
    <div className="flex items-center gap-2 rounded-lg border p-3 bg-muted/50">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-mono text-sm break-all">{value ?? "—"}</p>
      </div>
      {value && (
        <Button size="icon" variant="ghost" onClick={() => copyToClipboard(value, label)}>
          {copied === label ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-bold">Debug Info</h1>
        <Row label="User UID" value={uid} />
        <Row label={`OneSignal ID (${source || "loading…"})`} value={oneSignalId} />
      </div>
    </div>
  );
}
