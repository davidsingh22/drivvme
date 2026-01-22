export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      driver_documents: {
        Row: {
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          driver_id: string
          expires_at: string | null
          file_url: string
          id: string
          is_verified: boolean
          uploaded_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          driver_id: string
          expires_at?: string | null
          file_url: string
          id?: string
          is_verified?: boolean
          uploaded_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          driver_id?: string
          expires_at?: string | null
          file_url?: string
          id?: string
          is_verified?: boolean
          uploaded_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      driver_profiles: {
        Row: {
          average_rating: number | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          id: string
          is_online: boolean
          is_verified: boolean
          license_number: string | null
          license_plate: string | null
          stripe_account_id: string | null
          total_earnings: number | null
          total_rides: number | null
          updated_at: string
          user_id: string
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
        }
        Insert: {
          average_rating?: number | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_online?: boolean
          is_verified?: boolean
          license_number?: string | null
          license_plate?: string | null
          stripe_account_id?: string | null
          total_earnings?: number | null
          total_rides?: number | null
          updated_at?: string
          user_id: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Update: {
          average_rating?: number | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_online?: boolean
          is_verified?: boolean
          license_number?: string | null
          license_plate?: string | null
          stripe_account_id?: string | null
          total_earnings?: number | null
          total_rides?: number | null
          updated_at?: string
          user_id?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          ride_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          ride_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          ride_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          payer_id: string | null
          payment_type: string
          ride_id: string
          status: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          payer_id?: string | null
          payment_type: string
          ride_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          payer_id?: string | null
          payment_type?: string
          ride_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          language: Database["public"]["Enums"]["language_preference"]
          last_name: string | null
          phone_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          language?: Database["public"]["Enums"]["language_preference"]
          last_name?: string | null
          phone_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          language?: Database["public"]["Enums"]["language_preference"]
          last_name?: string | null
          phone_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          driver_id: string
          id: string
          rating: number
          ride_id: string
          rider_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          driver_id: string
          id?: string
          rating: number
          ride_id: string
          rider_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          rating?: number
          ride_id?: string
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      rides: {
        Row: {
          accepted_at: string | null
          actual_fare: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          distance_km: number | null
          driver_earnings: number | null
          driver_id: string | null
          dropoff_address: string
          dropoff_at: string | null
          dropoff_lat: number
          dropoff_lng: number
          estimated_duration_minutes: number | null
          estimated_fare: number
          id: string
          pickup_address: string
          pickup_at: string | null
          pickup_lat: number
          pickup_lng: number
          platform_fee: number | null
          requested_at: string
          rider_id: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          actual_fare?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          distance_km?: number | null
          driver_earnings?: number | null
          driver_id?: string | null
          dropoff_address: string
          dropoff_at?: string | null
          dropoff_lat: number
          dropoff_lng: number
          estimated_duration_minutes?: number | null
          estimated_fare: number
          id?: string
          pickup_address: string
          pickup_at?: string | null
          pickup_lat: number
          pickup_lng: number
          platform_fee?: number | null
          requested_at?: string
          rider_id?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          actual_fare?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          distance_km?: number | null
          driver_earnings?: number | null
          driver_id?: string | null
          dropoff_address?: string
          dropoff_at?: string | null
          dropoff_lat?: number
          dropoff_lng?: number
          estimated_duration_minutes?: number | null
          estimated_fare?: number
          id?: string
          pickup_address?: string
          pickup_at?: string | null
          pickup_lat?: number
          pickup_lng?: number
          platform_fee?: number | null
          requested_at?: string
          rider_id?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Relationships: []
      }
      translations: {
        Row: {
          created_at: string
          en: string
          fr: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          en: string
          fr: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          en?: string
          fr?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_driver: { Args: { _user_id: string }; Returns: boolean }
      is_rider: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      document_type: "license" | "insurance" | "registration"
      language_preference: "en" | "fr"
      payment_status: "pending" | "succeeded" | "failed" | "refunded"
      ride_status:
        | "pending_payment"
        | "searching"
        | "driver_assigned"
        | "driver_en_route"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
      user_role: "rider" | "driver" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      document_type: ["license", "insurance", "registration"],
      language_preference: ["en", "fr"],
      payment_status: ["pending", "succeeded", "failed", "refunded"],
      ride_status: [
        "pending_payment",
        "searching",
        "driver_assigned",
        "driver_en_route",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
      ],
      user_role: ["rider", "driver", "admin"],
    },
  },
} as const
