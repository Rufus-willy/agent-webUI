import { shell, safeStorage } from "electron";
import type { DeepSeekModel, SettingsStatus } from "../../shared/types";
import { DatabaseService } from "./database";

const DEEPSEEK_API_KEYS_URL = "https://platform.deepseek.com/api_keys";

export class SettingsService {
  constructor(private readonly db: DatabaseService) {}

  getStatus(): SettingsStatus {
    return {
      hasApiKey: Boolean(this.getApiKey()),
      model: this.db.getModel(),
      dataDir: this.db.getDataDir()
    };
  }

  getApiKey(): string | null {
    const encrypted = this.db.getSecret("deepseek.apiKey");
    if (!encrypted) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return null;
    }
  }

  saveApiKey(apiKey: string) {
    const clean = apiKey.trim();
    if (!clean) {
      throw new Error("API key 不能为空。");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不可用 Electron safeStorage，无法安全保存 API key。");
    }
    const encrypted = safeStorage.encryptString(clean).toString("base64");
    this.db.setSecret("deepseek.apiKey", encrypted);
  }

  setModel(model: DeepSeekModel) {
    this.db.setModel(model);
  }

  openDeepSeekPlatform() {
    shell.openExternal(DEEPSEEK_API_KEYS_URL);
  }
}
