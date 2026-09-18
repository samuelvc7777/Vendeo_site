import { TinderSession } from "../entities/Tinder";

export interface TinderMatchItem {
  id: string;
  username: string;
  fullName: string;
  avatar: string;
  isOnline: boolean;
  lastActive: string;
  lastMessage: string;
  unread: boolean;
  type: "tinder";
  lastSender: "me" | "them";
  isNewMatch: boolean;
  lastMessageAt?: string;
}

export interface TinderMessageItem {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
  isMine: boolean;
  liked?: boolean;
}

export interface ITinderRepository {
  connect(token: string): Promise<TinderSession>;
  disconnect(): Promise<void>;
  getSession(): Promise<TinderSession | null>;
  getMatches(): Promise<TinderMatchItem[]>;
  getMessages(matchId: string): Promise<TinderMessageItem[]>;
  sendMessage(matchId: string, text: string): Promise<TinderMessageItem>;
}
