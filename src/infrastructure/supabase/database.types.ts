export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  price: number;
  promotional_price: number | null;
  sku: string | null;
  is_active: boolean;
  is_featured: boolean;
  is_new: boolean;
  weight_grams: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImageRow {
  id: string;
  product_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_main: boolean;
  created_at: string;
}

export interface InstagramConversationRow {
  contact_id: string;
  account_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  profile_checked_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  status: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
  is_restricted: boolean | null;
  restricted_at: string | null;
  raffle_numbers: string | null;
  raffle_amount: number | null;
  finalized_at: string | null;
  last_direction: string | null;
  last_status: string | null;
  seen_at: string | null;
  follow_up_day: number | null;
  current_stage_id: string | null;
  stage_completed_rules: Json | null;
  ai_auto_respond: boolean | null;
  ai_debounce_until: string | null;
}

export interface InstagramMessageRow {
  id: string;
  conversation_id: string;
  account_id: string | null;
  sender_id: string;
  recipient_id: string | null;
  direction: string;
  type: string | null;
  text: string | null;
  media_url: string | null;
  created_at: string;
  received_at: string | null;
  raw_json: Json | null;
  status: string | null;
  deliver_at?: string | null;
  seen_at?: string | null;
  audio_transcript: string | null;
  audio_transcribed_at: string | null;
  audio_transcription_error: string | null;
  reply_to_message_id: string | null;
  is_edited: boolean;
  edited_at: string | null;
}

export interface TinderConversationRow {
  match_id: string;
  person_id: string;
  name: string;
  birth_date: string | null;
  bio: string | null;
  photos: Json | null;
  city: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_direction: string | null;
  status: string | null;
  seen_at: string | null;
  is_liked: boolean | null;
  invited_to_instagram_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TinderMessageRow {
  id: string;
  match_id: string;
  sender_id: string;
  message: string;
  sent_date: string;
  created_at: string;
  deliver_at?: string | null;
  seen_at?: string | null;
  status?: string | null;
}

export interface TinderConfigRow {
  id: string;
  auth_token: string | null;
  refresh_token: string | null;
  user_id: string | null;
  user_name: string | null;
  avatar_url: string | null;
  instagram_handle: string | null;
  auto_invite_enabled: boolean | null;
  invite_message_template: string | null;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: CategoryRow;
        Insert: Partial<CategoryRow>;
        Update: Partial<CategoryRow>;
      };
      products: {
        Row: ProductRow;
        Insert: Partial<ProductRow>;
        Update: Partial<ProductRow>;
      };
      product_images: {
        Row: ProductImageRow;
        Insert: Partial<ProductImageRow>;
        Update: Partial<ProductImageRow>;
      };
      instagram_conversations: {
        Row: InstagramConversationRow;
        Insert: Partial<InstagramConversationRow>;
        Update: Partial<InstagramConversationRow>;
      };
      instagram_messages: {
        Row: InstagramMessageRow;
        Insert: Partial<InstagramMessageRow>;
        Update: Partial<InstagramMessageRow>;
      };
      tinder_conversations: {
        Row: TinderConversationRow;
        Insert: Partial<TinderConversationRow>;
        Update: Partial<TinderConversationRow>;
      };
      tinder_messages: {
        Row: TinderMessageRow;
        Insert: Partial<TinderMessageRow>;
        Update: Partial<TinderMessageRow>;
      };
      tinder_config: {
        Row: TinderConfigRow;
        Insert: Partial<TinderConfigRow>;
        Update: Partial<TinderConfigRow>;
      };
    };
  };
}
