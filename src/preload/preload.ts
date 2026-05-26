import { contextBridge, ipcRenderer } from "electron";
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

contextBridge.exposeInMainWorld("agentAPI", {
  settings: {
    getStatus: () => ipcRenderer.invoke("settings:getStatus") as Promise<SettingsStatus>,
    saveApiKey: (apiKey: string) =>
      ipcRenderer.invoke("settings:saveApiKey", apiKey) as Promise<SaveApiKeyResult>,
    validateApiKey: (apiKey: string) => ipcRenderer.invoke("settings:validateApiKey", apiKey) as Promise<boolean>,
    setModel: (model: DeepSeekModel) => ipcRenderer.invoke("settings:setModel", model) as Promise<SettingsStatus>,
    openDeepSeekPlatform: () => ipcRenderer.invoke("settings:openDeepSeekPlatform") as Promise<void>
  },
  sessions: {
    list: () => ipcRenderer.invoke("sessions:list") as Promise<SessionSummary[]>,
    create: () => ipcRenderer.invoke("sessions:create") as Promise<SessionSummary>,
    get: (id: string) => ipcRenderer.invoke("sessions:get", id) as Promise<SessionDetail>,
    rename: (id: string, title: string) =>
      ipcRenderer.invoke("sessions:rename", id, title) as Promise<SessionSummary>,
    delete: (id: string) => ipcRenderer.invoke("sessions:delete", id) as Promise<void>
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list") as Promise<SkillPackSummary[]>,
    addDirectory: () => ipcRenderer.invoke("skills:addDirectory") as Promise<SkillPackSummary[] | null>,
    setActive: (id: string, active: boolean) =>
      ipcRenderer.invoke("skills:setActive", id, active) as Promise<SkillPackSummary[]>
  },
  chat: {
    sendMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke("chat:sendMessage", sessionId, content) as Promise<ChatSendResult>,
    cancel: (sessionId: string) => ipcRenderer.invoke("chat:cancel", sessionId) as Promise<boolean>,
    onDelta: (callback: (event: ChatDeltaEvent) => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: ChatDeltaEvent) => callback(event);
      ipcRenderer.on("chat:delta", listener);
      return () => ipcRenderer.removeListener("chat:delta", listener);
    },
    onResearchStatus: (callback: (event: ResearchStatusEvent) => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: ResearchStatusEvent) => callback(event);
      ipcRenderer.on("research:status", listener);
      return () => ipcRenderer.removeListener("research:status", listener);
    }
  },
  artifacts: {
    saveAs: (id: string) => ipcRenderer.invoke("artifacts:saveAs", id) as Promise<boolean>,
    open: (id: string) => ipcRenderer.invoke("artifacts:open", id) as Promise<void>
  }
});
