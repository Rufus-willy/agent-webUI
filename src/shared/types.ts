export type DeepSeekModel = "deepseek-v4-pro" | "deepseek-v4-flash";

export type ResearchStage = "idle" | "clarifying" | "researching" | "completed";

export type Role = "system" | "user" | "assistant";

export interface SettingsStatus {
  hasApiKey: boolean;
  model: DeepSeekModel;
  dataDir: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  researchStage: ResearchStage;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  createdAt: string;
  artifactIds: string[];
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  kind: "markdown" | "pdf";
  title: string;
  filePath: string;
  createdAt: string;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: MessageRecord[];
  artifacts: ArtifactRecord[];
}

export interface ChatDeltaEvent {
  sessionId: string;
  messageId: string;
  delta: string;
  done?: boolean;
}

export interface ResearchStatusEvent {
  sessionId: string;
  status: string;
}

export interface ChatSendResult {
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  session: SessionSummary;
  artifacts: ArtifactRecord[];
}

export interface SaveApiKeyResult {
  ok: boolean;
  error?: string;
}

export interface SkillPackSummary {
  id: string;
  name: string;
  path: string;
  active: boolean;
  builtIn: boolean;
  skillCount: number;
  description?: string;
}

export interface SemanticPaper {
  paperId: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  citationCount?: number | null;
  referenceCount?: number | null;
  venue?: string | null;
  publicationDate?: string | null;
  authors?: Array<{ authorId?: string | null; name: string }>;
  openAccessPdf?: { url?: string | null; status?: string | null } | null;
  tldr?: { text?: string | null } | null;
  externalIds?: Record<string, string | number> | null;
}
