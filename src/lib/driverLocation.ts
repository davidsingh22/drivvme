import { supabase } from "@/integrations/supabase/client";

type UpdateLocationInput = {
  driverId: string;  // your drivers table id
  userId: string;    // auth user id
  lat: number;
  lng: number;
  heading?: number | null;
  speedKph?: number | null;
  isOnline: boolean;
};

export async function upsertDriverLocation(input: UpdateLocationInput) {
  const { error } = await supabase
    .from("driver_locations")
    .upsert(
      {
        driver_id: input.driverId,
        user_id: input.userId,
        lat: input.lat,
        lng: input.lng,
        heading: input.heading ?? null,
        speed_kph: input.speedKph ?? null,
        is_online: input.isOnline,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "driver_id" }
    );

  if (error) throw error;
}

export async function setDriverOffline(driverId: string) {
  const { error } = await supabase
    .from("driver_locations")
    .update({
      is_online: false,
      updated_at: new Date().toISOString(),
    })
    .eq("driver_id", driverId);

  if (error) throw error;
}