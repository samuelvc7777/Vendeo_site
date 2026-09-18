import { AutoPilotConfig, AutoPilotChatState } from "../entities/AutoPilot";

export interface IAutoPilotRepository {
  getConfig(): Promise<AutoPilotConfig>;
  saveConfig(config: Partial<AutoPilotConfig>): Promise<AutoPilotConfig>;
  getAllChatStates(): Promise<Record<string, AutoPilotChatState>>;
  getChatState(conversationId: string): Promise<AutoPilotChatState | null>;
  saveChatState(conversationId: string, state: Partial<AutoPilotChatState>): Promise<AutoPilotChatState>;
  resetChatDebounce(conversationId: string, lastMessageTimestamp?: string): Promise<AutoPilotChatState>;
}
