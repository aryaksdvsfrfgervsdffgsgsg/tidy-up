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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      auction_events: {
        Row: {
          actor_id: string | null
          auction_id: string
          created_at: string
          details: Json
          event_type: string
          id: string
          summary: string
        }
        Insert: {
          actor_id?: string | null
          auction_id: string
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          summary: string
        }
        Update: {
          actor_id?: string | null
          auction_id?: string
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_events_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_messages: {
        Row: {
          auction_id: string
          content: string
          created_at: string
          id: string
          sender_name: string
          user_id: string
        }
        Insert: {
          auction_id: string
          content: string
          created_at?: string
          id?: string
          sender_name?: string
          user_id: string
        }
        Update: {
          auction_id?: string
          content?: string
          created_at?: string
          id?: string
          sender_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_messages_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_participants: {
        Row: {
          auction_id: string
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          auction_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          auction_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_participants_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_payments: {
        Row: {
          amount_inr: number
          auction_id: string
          created_at: string
          failure_reason: string | null
          id: string
          paid_at: string | null
          payer_id: string
          razorpay_order_id: string
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          status: string
        }
        Insert: {
          amount_inr: number
          auction_id: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          payer_id: string
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          status?: string
        }
        Update: {
          amount_inr?: number
          auction_id?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          payer_id?: string
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_payments_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      auctions: {
        Row: {
          bid_count: number
          created_at: string
          current_price: number
          description: string
          ends_at: string | null
          id: string
          item_count: number
          last_seq: number
          leader_id: string | null
          leader_name: string | null
          listing_currency: string
          locked: boolean
          min_increment: number
          owner_id: string
          participant_limit: number | null
          payment_confirmed_at: string | null
          payment_confirmed_by: string | null
          starting_price: number
          starts_at: string | null
          status: string
          title: string
          visibility: string
        }
        Insert: {
          bid_count?: number
          created_at?: string
          current_price?: number
          description?: string
          ends_at?: string | null
          id?: string
          item_count?: number
          last_seq?: number
          leader_id?: string | null
          leader_name?: string | null
          listing_currency?: string
          locked?: boolean
          min_increment?: number
          owner_id: string
          participant_limit?: number | null
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          starting_price?: number
          starts_at?: string | null
          status?: string
          title: string
          visibility?: string
        }
        Update: {
          bid_count?: number
          created_at?: string
          current_price?: number
          description?: string
          ends_at?: string | null
          id?: string
          item_count?: number
          last_seq?: number
          leader_id?: string | null
          leader_name?: string | null
          listing_currency?: string
          locked?: boolean
          min_increment?: number
          owner_id?: string
          participant_limit?: number | null
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          starting_price?: number
          starts_at?: string | null
          status?: string
          title?: string
          visibility?: string
        }
        Relationships: []
      }
      bids: {
        Row: {
          amount: number
          amount_inr: number | null
          auction_id: string
          bidder_id: string
          bidder_name: string
          created_at: string
          id: string
          payment_ack: boolean
          seq: number
        }
        Insert: {
          amount: number
          amount_inr?: number | null
          auction_id: string
          bidder_id: string
          bidder_name?: string
          created_at?: string
          id?: string
          payment_ack?: boolean
          seq: number
        }
        Update: {
          amount?: number
          amount_inr?: number | null
          auction_id?: string
          bidder_id?: string
          bidder_name?: string
          created_at?: string
          id?: string
          payment_ack?: boolean
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_auction_closed: boolean
          email_new_bids: boolean
          in_app_auction_closed: boolean
          in_app_new_bids: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_auction_closed?: boolean
          email_new_bids?: boolean
          in_app_auction_closed?: boolean
          in_app_new_bids?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_auction_closed?: boolean
          email_new_bids?: boolean
          in_app_auction_closed?: boolean
          in_app_new_bids?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          auction_id: string | null
          body: string
          created_at: string
          id: string
          notification_type: string
          payload: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          auction_id?: string | null
          body: string
          created_at?: string
          id?: string
          notification_type: string
          payload?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          auction_id?: string | null
          body?: string
          created_at?: string
          id?: string
          notification_type?: string
          payload?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_auction_invariant: { Args: { p_auction_id: string }; Returns: Json }
      confirm_auction_payment: { Args: { p_auction_id: string }; Returns: Json }
      has_joined_auction: {
        Args: { p_auction_id: string; p_user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invite_to_auction: {
        Args: { p_auction_id: string; p_email: string }
        Returns: Json
      }
      is_auction_owner: {
        Args: { p_auction_id: string; p_user_id: string }
        Returns: boolean
      }
      is_auction_participant: {
        Args: { p_auction_id: string; p_user_id: string }
        Returns: boolean
      }
      join_private_auction: { Args: { p_auction_id: string }; Returns: Json }
      place_bid: {
        Args: {
          p_amount: number
          p_amount_inr?: number
          p_auction_id: string
          p_payment_ack?: boolean
        }
        Returns: Json
      }
      set_admin_role: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: boolean
      }
      sync_auction_close: { Args: { p_auction_id: string }; Returns: boolean }
      sync_auction_start: { Args: { p_auction_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
