import OneSignal from "react-onesignal";
import { Button } from "@/components/ui/button";

function EnableNotificationsButton() {
  const enable = async () => {
    try {
      await OneSignal.Slidedown.promptPush();
      console.log("OneSignal prompt triggered");
    } catch (err) {
      console.error("OneSignal error:", err);
    }
  };

  return (
    <Button onClick={enable} className="rounded-xl px-6 py-3 text-base">
      Enable Notifications
    </Button>
  );
}

export default EnableNotificationsButton;
