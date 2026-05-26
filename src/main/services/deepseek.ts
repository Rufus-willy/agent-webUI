import type { DeepSeekModel } from "../../shared/types";
import { SettingsService } from "./settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekChoice {
  message?: { content?: string };
  delta?: { content?: string };
}

interface DeepSeekResponse {
  error?: { message?: string };
  choices?: DeepSeekChoice[];
}

const BASE_URL = "https://api.deepseek.com";

function explainHttpError(status: number, body: string) {
  if (status === 401 || status === 403) {
    return "DeepSeek API key 无效或没有权限，请重新配置。";
  }
  if (status === 429) {
    return "DeepSeek 当前限流了，请稍后重试。";
  }
  return `DeepSeek 请求失败 (${status})：${body.slice(0, 300)}`;
}

export class DeepSeekService {
  constructor(private readonly settings: SettingsService) {}

  get model(): DeepSeekModel {
    return this.settings.getStatus().model;
  }

  async validateApiKey(apiKey: string) {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`
      }
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return Boolean(payload.data?.some((model) => model.id === "deepseek-v4-pro"));
  }

  async complete(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}) {
    const apiKey = this.requireApiKey();
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 2200
      })
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(explainHttpError(response.status, body));
    }
    const payload = JSON.parse(body) as DeepSeekResponse;
    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }
    return payload.choices?.[0]?.message?.content?.trim() || "";
  }

  async stream(
    messages: ChatMessage[],
    onDelta: (delta: string) => void,
    options: { temperature?: number; maxTokens?: number } = {}
  ) {
    const apiKey = this.requireApiKey();
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.25,
        max_tokens: options.maxTokens ?? 5200
      })
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(explainHttpError(response.status, body));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const lines = chunk.split("\n").filter((line) => line.startsWith("data:"));
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "").trim();
          if (!data || data === "[DONE]") {
            continue;
          }
          const payload = JSON.parse(data) as DeepSeekResponse;
          const delta = payload.choices?.[0]?.delta?.content || "";
          if (delta) {
            content += delta;
            onDelta(delta);
          }
        }
      }
    }

    return content.trim();
  }

  private requireApiKey() {
    const apiKey = this.settings.getApiKey();
    if (!apiKey) {
      throw new Error("请先配置 DeepSeek API key。");
    }
    return apiKey;
  }
}
