import type {
  ChatDeltaEvent,
  ChatSendResult,
  DeepSeekModel,
  ResearchStatusEvent,
  SaveApiKeyResult,
  SessionDetail,
  SessionSummary,
  SkillPackSummary,
  SettingsStatus
} from "../shared/types";

declare global {
  interface Window {
    agentAPI: {
      settings: {
        getStatus(): Promise<SettingsStatus>;
        saveApiKey(apiKey: string): Promise<SaveApiKeyResult>;
        validateApiKey(apiKey: string): Promise<boolean>;
        setModel(model: DeepSeekModel): Promise<SettingsStatus>;
        openDeepSeekPlatform(): Promise<void>;
      };
      sessions: {
        list(): Promise<SessionSummary[]>;
        create(): Promise<SessionSummary>;
        get(id: string): Promise<SessionDetail>;
        rename(id: string, title: string): Promise<SessionSummary>;
        delete(id: string): Promise<void>;
      };
      skills: {
        list(): Promise<SkillPackSummary[]>;
        addDirectory(): Promise<SkillPackSummary[] | null>;
        setActive(id: string, active: boolean): Promise<SkillPackSummary[]>;
      };
      chat: {
        sendMessage(sessionId: string, content: string): Promise<ChatSendResult>;
        cancel(sessionId: string): Promise<boolean>;
        onDelta(callback: (event: ChatDeltaEvent) => void): () => void;
        onResearchStatus(callback: (event: ResearchStatusEvent) => void): () => void;
      };
      artifacts: {
        saveAs(id: string): Promise<boolean>;
        open(id: string): Promise<void>;
      };
    };
  }
}
