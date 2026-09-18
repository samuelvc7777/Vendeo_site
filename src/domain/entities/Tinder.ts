export interface TinderProfile {
  id: string;
  name: string;
  bio?: string;
  birthDate?: string;
  photos: {
    id: string;
    url: string;
  }[];
  isVerified?: boolean;
}

export interface TinderSession {
  token: string;
  isConnected: boolean;
  profile?: TinderProfile;
  connectedAt?: string;
}

export interface TinderRawMessage {
  _id: string;
  match_id: string;
  sent_date: string;
  message: string;
  to: string;
  from: string;
  timestamp: number;
}

export interface TinderRawPerson {
  _id: string;
  name: string;
  bio?: string;
  birth_date?: string;
  photos?: {
    id: string;
    url: string;
    processedFiles?: { url: string; width: number; height: number }[];
  }[];
}

export interface TinderRawMatch {
  id: string;
  person?: TinderRawPerson;
  messages: TinderRawMessage[];
  last_activity_date: string;
  created_date?: string;
  is_new_match?: boolean;
  following?: boolean;
  unread_count?: number;
}
