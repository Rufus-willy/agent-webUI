import type { WebContents } from "electron";
import type {
  ArtifactRecord,
  ChatDeltaEvent,
  ChatSendResult,
  MessageRecord,
  ResearchStatusEvent
} from "../../shared/types";
import { DatabaseService } from "./database";
import { DeepSeekService, type ChatMessage } from "./deepseek";
import { ReportService } from "./report";
import { SemanticScholarService } from "./semanticScholar";
import { SkillLoader } from "./skillLoader";

function compactTitle(input: string) {
  return input.replace(/\s+/g, " ").trim().slice(0, 28) || "新文献调研";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) {
    return null;
  }
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class ResearchAgentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly deepSeek: DeepSeekService,
    private readonly semanticScholar: SemanticScholarService,
    private readonly skills: SkillLoader,
    private readonly reports: ReportService
  ) {}

  async sendMessage(sessionId: string, content: string, webContents: WebContents): Promise<ChatSendResult> {
    const session = this.db.getSession(sessionId) || this.db.createSession();
    const previousMessages = this.db.listMessages(session.id);
    if (!previousMessages.length) {
      this.db.renameSession(session.id, compactTitle(content));
    }
    if (session.researchStage === "researching") {
      throw new Error("当前会话正在调研中，请等待本轮调研完成。");
    }

    const userMessage = this.db.addMessage({ sessionId: session.id, role: "user", content });
    const refreshedSession = this.db.getSession(session.id)!;

    if (refreshedSession.researchStage === "idle") {
      const assistantMessage = await this.askClarifyingQuestions(session.id, webContents);
      const latest = this.db.getSession(session.id)!;
      return { userMessage, assistantMessage, session: latest, artifacts: [] };
    }

    if (refreshedSession.researchStage === "clarifying") {
      const { assistantMessage, artifacts } = await this.runResearch(session.id, webContents);
      const latest = this.db.getSession(session.id)!;
      return { userMessage, assistantMessage, session: latest, artifacts };
    }

    const assistantMessage = await this.followUp(session.id, webContents);
    const latest = this.db.getSession(session.id)!;
    return { userMessage, assistantMessage, session: latest, artifacts: [] };
  }

  private async askClarifyingQuestions(sessionId: string, webContents: WebContents): Promise<MessageRecord> {
    const messageId = crypto.randomUUID();
    const messages = this.db.listMessages(sessionId);
    const prompt = this.skills.getResearchPrompt();
    const content = await this.streamToRenderer(
      sessionId,
      messageId,
      [
        {
          role: "system",
          content: `${prompt}\n\n你现在处于调研准备阶段。必须先帮助使用人明确需求，不要开始检索。请用中文提出 3-5 个澄清问题，问题要具体、好回答，并说明回答后你会开始检索和生成 Markdown/PDF 调研报告。`
        },
        ...messages.map((message) => ({ role: message.role, content: message.content } as ChatMessage))
      ],
      webContents,
      { maxTokens: 1400 }
    );
    this.db.updateSessionStage(sessionId, "clarifying");
    return this.db.addMessage({ id: messageId, sessionId, role: "assistant", content });
  }

  private async runResearch(
    sessionId: string,
    webContents: WebContents
  ): Promise<{ assistantMessage: MessageRecord; artifacts: ArtifactRecord[] }> {
    this.db.updateSessionStage(sessionId, "researching");
    const status = (message: string) => this.emitStatus(webContents, sessionId, message);
    const allMessages = this.db.listMessages(sessionId);
    const topicContext = allMessages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n\n");
    const session = this.db.getSession(sessionId)!;

    status("正在加载 literature-research skills...");
    const skillPrompt = this.skills.getResearchPrompt();

    status("正在生成 Semantic Scholar 检索式...");
    const searchQuery = await this.makeSearchQuery(topicContext, skillPrompt);

    let papersText = "";
    let paperCount = 0;
    let retrievalNote = "";
    status(`正在检索 Semantic Scholar：${searchQuery}`);
    status("如 Semantic Scholar 限流，将自动切换 OpenAlex 兜底检索...");
    const searchResult = await this.semanticScholar.searchWithFallback(searchQuery, 24);
    paperCount = searchResult.papers.length;
    retrievalNote = searchResult.note;
    papersText = this.semanticScholar.formatForPrompt(searchResult.papers);

    if (!paperCount) {
      const failureMessage = [
        "这次没有生成最终 PDF/Markdown 报告，因为没有检索到可核验的真实文献。",
        "",
        "我已经尝试了 Semantic Scholar，并在失败或限流时切换到 OpenAlex 兜底，但两边都没有返回可用结果。为了避免生成“零篇文献”的演示稿，我先暂停在这里。",
        "",
        `检索式：${searchQuery}`,
        "",
        "可以稍后直接回复“重新检索”，或者把范围放宽一些，例如减少 pH、年份、论文类型限制。"
      ].join("\n");
      this.db.updateSessionStage(sessionId, "clarifying");
      const assistantMessage = this.db.addMessage({
        sessionId,
        role: "assistant",
        content: failureMessage
      });
      status("未检索到真实文献，已暂停生成报告。");
      return { assistantMessage, artifacts: [] };
    }

    status("正在综合证据并生成最终调研报告...");
    const reportMessageId = crypto.randomUUID();
    const reportMarkdown = await this.streamToRenderer(
      sessionId,
      reportMessageId,
      [
        {
          role: "system",
          content: `${skillPrompt}\n\n你现在必须输出最终调研报告。报告必须是中文 Markdown，不要输出寒暄。必须包含：研究问题、检索方法、核心结论、代表性文献表、证据强度、争议点、研究空白、后续建议、参考文献与链接。你只能基于提供的真实论文元数据总结；不得声称“零篇原始论文”“检索工具故障”“仅作为结构演示”，除非论文元数据为空。`
        },
        {
          role: "user",
          content: [
            `用户调研需求与澄清信息：\n${topicContext}`,
            `检索说明：${retrievalNote}`,
            `检索式：${searchQuery}`,
            `候选文献数量：${paperCount}`,
            `论文元数据：\n${papersText}`,
            `请基于以上论文和 skills 生成可直接下载归档的完整调研报告。不要虚构未提供的事实；如果某项证据不足，请明确写出“证据有限”，但不要把报告写成检索失败说明。`
          ].join("\n\n")
        }
      ],
      webContents,
      { maxTokens: 6800, temperature: 0.2 }
    );

    status("正在写入 Markdown 与 PDF 文件...");
    const { markdownPath, pdfPath } = await this.reports.writeReportFiles(session.title, reportMarkdown);
    const markdownArtifact = this.db.addArtifact({
      sessionId,
      kind: "markdown",
      title: `${session.title} - Markdown 报告`,
      filePath: markdownPath
    });
    const pdfArtifact = this.db.addArtifact({
      sessionId,
      kind: "pdf",
      title: `${session.title} - PDF 报告`,
      filePath: pdfPath
    });

    const finalNote = `\n\n---\n\n已生成本地调研文档：Markdown 和 PDF。你可以点击下方按钮保存到指定位置。`;
    webContents.send("chat:delta", {
      sessionId,
      messageId: reportMessageId,
      delta: finalNote,
      done: true
    } satisfies ChatDeltaEvent);

    const artifacts = [markdownArtifact, pdfArtifact];
    const assistantMessage = this.db.addMessage({
      id: reportMessageId,
      sessionId,
      role: "assistant",
      content: `${reportMarkdown}${finalNote}`,
      artifactIds: artifacts.map((artifact) => artifact.id)
    });
    this.db.updateSessionStage(sessionId, "completed");
    status(`调研完成：已检索 ${paperCount} 篇候选文献，并生成 Markdown/PDF。`);
    return { assistantMessage, artifacts };
  }

  private async followUp(sessionId: string, webContents: WebContents): Promise<MessageRecord> {
    const messageId = crypto.randomUUID();
    const messages = this.db.listMessages(sessionId).slice(-12);
    const content = await this.streamToRenderer(
      sessionId,
      messageId,
      [
        {
          role: "system",
          content:
            "你是一个中文文献调研助手。基于当前会话和已经生成的报告回答追问；如果用户要求新的调研主题，请建议新建会话。不要编造论文信息。"
        },
        ...messages.map((message) => ({ role: message.role, content: message.content } as ChatMessage))
      ],
      webContents,
      { maxTokens: 2200 }
    );
    return this.db.addMessage({ id: messageId, sessionId, role: "assistant", content });
  }

  private async makeSearchQuery(topicContext: string, skillPrompt: string) {
    const raw = await this.deepSeek.complete(
      [
        {
          role: "system",
          content: `${skillPrompt}\n\n你要把中文调研需求转换为适合 Semantic Scholar 的英文检索式。只输出 JSON。`
        },
        {
          role: "user",
          content:
            `请生成 JSON：{"query":"英文检索式","scope":"中文范围摘要"}。\n\n用户需求：\n${topicContext}`
        }
      ],
      { maxTokens: 700, temperature: 0.1 }
    );
    const parsed = extractJsonObject(raw);
    const query = typeof parsed?.query === "string" ? parsed.query.trim() : "";
    return query || topicContext.split(/\s+/).slice(0, 18).join(" ");
  }

  private async streamToRenderer(
    sessionId: string,
    messageId: string,
    messages: ChatMessage[],
    webContents: WebContents,
    options: { maxTokens?: number; temperature?: number } = {}
  ) {
    let full = "";
    const content = await this.deepSeek.stream(
      messages,
      (delta) => {
        full += delta;
        webContents.send("chat:delta", { sessionId, messageId, delta } satisfies ChatDeltaEvent);
      },
      options
    );
    webContents.send("chat:delta", {
      sessionId,
      messageId,
      delta: "",
      done: true
    } satisfies ChatDeltaEvent);
    return content || full.trim();
  }

  private emitStatus(webContents: WebContents, sessionId: string, status: string) {
    webContents.send("research:status", { sessionId, status } satisfies ResearchStatusEvent);
  }
}
