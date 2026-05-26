import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type { DeepSeekModel } from "../shared/types";
import { DatabaseService } from "./services/database";
import { DeepSeekService } from "./services/deepseek";
import { ReportService } from "./services/report";
import { ResearchAgentService } from "./services/researchAgent";
import { SemanticScholarService } from "./services/semanticScholar";
import { SettingsService } from "./services/settings";
import { SkillLoader } from "./services/skillLoader";

let mainWindow: BrowserWindow | null = null;
const db = new DatabaseService();
const settings = new SettingsService(db);
const deepSeek = new DeepSeekService(settings);
const semanticScholar = new SemanticScholarService();
const skills = new SkillLoader();
const reports = new ReportService();
const researchAgent = new ResearchAgentService(db, deepSeek, semanticScholar, skills, reports);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "Agent WebUI",
    backgroundColor: "#f7f7f8",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("settings:getStatus", () => settings.getStatus());

  ipcMain.handle("settings:validateApiKey", async (_, apiKey: string) => deepSeek.validateApiKey(apiKey));

  ipcMain.handle("settings:saveApiKey", async (_, apiKey: string) => {
    try {
      const ok = await deepSeek.validateApiKey(apiKey);
      if (!ok) {
        return { ok: false, error: "DeepSeek API key 验证失败，请检查后重试。" };
      }
      settings.saveApiKey(apiKey);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("settings:setModel", (_, model: DeepSeekModel) => {
    settings.setModel(model);
    return settings.getStatus();
  });

  ipcMain.handle("settings:openDeepSeekPlatform", () => settings.openDeepSeekPlatform());

  ipcMain.handle("sessions:list", () => db.listSessions());
  ipcMain.handle("sessions:create", () => db.createSession());
  ipcMain.handle("sessions:get", (_, id: string) => db.getSessionDetail(id));
  ipcMain.handle("sessions:rename", (_, id: string, title: string) => db.renameSession(id, title));
  ipcMain.handle("sessions:delete", (_, id: string) => db.deleteSession(id));

  ipcMain.handle("chat:sendMessage", async (_, sessionId: string, content: string) => {
    if (!mainWindow) {
      throw new Error("主窗口尚未准备好。");
    }
    return researchAgent.sendMessage(sessionId, content, mainWindow.webContents);
  });

  ipcMain.handle("chat:cancel", (_, sessionId: string) => researchAgent.cancel(sessionId));

  ipcMain.handle("artifacts:saveAs", async (_, id: string) => {
    const artifact = db.getArtifact(id);
    if (!artifact) {
      throw new Error("找不到这个文件记录。");
    }
    const saveOptions = {
      title: "保存调研文档",
      defaultPath: artifact.title.replace(/[\\/:*?"<>|]/g, "-") + (artifact.kind === "pdf" ? ".pdf" : ".md"),
      filters:
        artifact.kind === "pdf"
          ? [{ name: "PDF", extensions: ["pdf"] }]
          : [{ name: "Markdown", extensions: ["md"] }]
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) {
      return false;
    }
    fs.copyFileSync(artifact.filePath, result.filePath);
    return true;
  });

  ipcMain.handle("artifacts:open", async (_, id: string) => {
    const artifact = db.getArtifact(id);
    if (!artifact) {
      throw new Error("找不到这个文件记录。");
    }
    await shell.openPath(artifact.filePath);
  });
}

app.whenReady().then(async () => {
  app.setName("Agent WebUI");
  await db.init();
  skills.load();
  reports.getReportsDir();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
