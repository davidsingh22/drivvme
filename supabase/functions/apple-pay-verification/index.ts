import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

serve(async () => {
  const verificationContent = Deno.env.get("APPLE_PAY_DOMAIN_VERIFICATION");
  
  if (!verificationContent) {
    return new Response("Verification file not configured", { status: 404 });
  }

  return new Response(verificationContent, {
    headers: {
      "Content-Type": "text/plain",
    },
  });
});
