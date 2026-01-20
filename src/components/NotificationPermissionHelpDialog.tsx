import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NotificationPermissionHelpDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enable notifications</DialogTitle>
          <DialogDescription>
            Notifications are currently blocked for this site. You must enable them in your browser/OS settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section className="space-y-1">
            <h3 className="font-medium">Chrome (desktop / Android)</h3>
            <p className="text-muted-foreground">
              Click the lock icon in the address bar → Site settings → Notifications → Allow.
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="font-medium">Safari (iPhone / iPad)</h3>
            <p className="text-muted-foreground">
              On iOS/iPadOS, web push only works for an installed web app.
            </p>
            <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
              <li>Open this site in Safari.</li>
              <li>Tap Share → <span className="font-medium">Add to Home Screen</span>.</li>
              <li>Open the app from your Home Screen.</li>
              <li>When prompted, allow notifications (and ensure Focus/Do Not Disturb is off).</li>
            </ol>
          </section>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
