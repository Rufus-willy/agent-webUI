import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Send,
  Settings,
  Square,
  Trash2
} from "lucide-react";
import type {
  ArtifactRecord,
  DeepSeekModel,
  MessageRecord,
  SessionDetail,
  SessionSummary,
  SettingsStatus
} from "../shared/types";

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function groupSessions(sessions: SessionSummary[]) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const groups: Record<string, SessionSummary[]> = {
    今天: [],
    "最近 7 天": [],
    更早: []
  };
  sessions.forEach((session) => {
    const age = now - new Date(session.updatedAt).getTime();
    if (age < day) groups["今天"].push(session);
    else if (age < day * 7) groups["最近 7 天"].push(session);
    else groups["更早"].push(session);
  });
  return Object.entries(groups).filter(([, items]) => items.length > 0);
}

function MarkdownView({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const nodes: JSX.Element[] = [];
  let table: string[] = [];
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((line) => !/^\|\s*-+/.test(line));
    nodes.push(
      <table className="message-table" key={`table-${nodes.length}`}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row}>
              {row
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((cell, index) =>
                  rowIndex === 0 ? (
                    <th key={`${cell}-${index}`}>{cell.trim()}</th>
                  ) : (
                    <td key={`${cell}-${index}`}>{cell.trim()}</td>
                  )
                )}
            </tr>
          ))}
        </tbody>
      </table>
    );
    table = [];
  };

  lines.forEach((line, index) => {
    if (/^\|.+\|$/.test(line.trim())) {
      table.push(line.trim());
      return;
    }
    flushTable();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 4)}` as keyof JSX.IntrinsicElements;
      nodes.push(<Tag key={index}>{heading[2]}</Tag>);
      return;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      nodes.push(
        <p className="bullet-line" key={index}>
          {bullet[1]}
        </p>
      );
      return;
    }
    if (!line.trim()) {
      nodes.push(<div className="message-space" key={index} />);
      return;
    }
    nodes.push(<p key={index}>{line}</p>);
  });
  flushTable();
  return <div className="markdown-view">{nodes}</div>;
}

function ApiKeyModal({
  onSaved,
  status
}: {
  onSaved: (status: SettingsStatus) => void;
  status: SettingsStatus | null;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setSaving(true);
    const result = await window.agentAPI.settings.saveApiKey(apiKey);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "保存失败，请检查 API key。");
      return;
    }
    onSaved(await window.agentAPI.settings.getStatus());
  }

  return (
    <div className="modal-backdrop">
      <section className="key-modal" aria-label="配置 DeepSeek API Key">
        <div className="modal-icon">
          <KeyRound size={22} />
        </div>
        <h1>配置 DeepSeek API key</h1>
        <p>首次使用需要连接 DeepSeek。API key 会加密保存在这台 Mac 的本地数据目录中。</p>
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          placeholder="粘贴 sk-... API key"
          autoFocus
        />
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => window.agentAPI.settings.openDeepSeekPlatform()}>
            <ExternalLink size={16} />
            打开 API 平台
          </button>
          <button className="primary-button" disabled={!apiKey.trim() || saving} onClick={save}>
            {saving ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
            验证并保存
          </button>
        </div>
        <div className="data-dir">本地数据目录：{status?.dataDir || "初始化中..."}</div>
      </section>
    </div>
  );
}

function ArtifactButtons({ artifacts }: { artifacts: ArtifactRecord[] }) {
  if (!artifacts.length) return null;
  return (
    <div className="artifact-row">
      {artifacts.map((artifact) => (
        <div className="artifact-pill" key={artifact.id}>
          <FileText size={16} />
          <span>{artifact.kind === "pdf" ? "PDF 报告" : "Markdown 报告"}</span>
          <button title="保存到本地" onClick={() => window.agentAPI.artifacts.saveAs(artifact.id)}>
            <Download size={15} />
          </button>
          <button title="打开文件" onClick={() => window.agentAPI.artifacts.open(artifact.id)}>
            <ExternalLink size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [followOutput, setFollowOutput] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const messageListRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const currentSessionId = detail?.session.id || "";
  const artifactsById = useMemo(() => {
    const map = new Map<string, ArtifactRecord>();
    detail?.artifacts.forEach((artifact) => map.set(artifact.id, artifact));
    return map;
  }, [detail?.artifacts]);

  async function refreshSessions() {
    const items = await window.agentAPI.sessions.list();
    setSessions(items);
    return items;
  }

  async function loadSession(id: string) {
    const next = await window.agentAPI.sessions.get(id);
    setDetail(next);
    setStatusText("");
    setFollowOutput(true);
    setShowJumpToBottom(false);
  }

  async function bootstrap() {
    try {
      const status = await window.agentAPI.settings.getStatus();
      setSettingsStatus(status);
      const items = await refreshSessions();
      if (items.length) {
        await loadSession(items[0].id);
      } else {
        const created = await window.agentAPI.sessions.create();
        await refreshSessions();
        await loadSession(created.id);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    const offDelta = window.agentAPI.chat.onDelta((event) => {
      if (!event.sessionId || event.sessionId !== currentSessionId) return;
      setDetail((current) => {
        if (!current) return current;
        const existing = current.messages.find((message) => message.id === event.messageId);
        let messages: MessageRecord[];
        if (existing) {
          messages = current.messages.map((message) =>
            message.id === event.messageId ? { ...message, content: message.content + event.delta } : message
          );
        } else {
          messages = [
            ...current.messages,
            {
              id: event.messageId,
              sessionId: event.sessionId,
              role: "assistant",
              content: event.delta,
              createdAt: new Date().toISOString(),
              artifactIds: []
            }
          ];
        }
        return { ...current, messages };
      });
    });
    const offStatus = window.agentAPI.chat.onResearchStatus((event) => {
      if (event.sessionId === currentSessionId) {
        setStatusText(event.status);
      }
    });
    return () => {
      offDelta();
      offStatus();
    };
  }, [currentSessionId]);

  function isNearBottom(element: HTMLElement) {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    scrollRef.current?.scrollIntoView({ behavior, block: "end" });
  }

  function handleMessageScroll() {
    const element = messageListRef.current;
    if (!element) return;
    const nearBottom = isNearBottom(element);
    setFollowOutput(nearBottom);
    setShowJumpToBottom(!nearBottom);
  }

  useEffect(() => {
    if (!followOutput) return;
    scrollToBottom("smooth");
  }, [detail?.messages, statusText, followOutput]);

  async function newSession() {
    const session = await window.agentAPI.sessions.create();
    await refreshSessions();
    await loadSession(session.id);
  }

  async function deleteSession(id: string) {
    await window.agentAPI.sessions.delete(id);
    const items = await refreshSessions();
    if (items.length) {
      await loadSession(items[0].id);
    } else {
      const created = await window.agentAPI.sessions.create();
      await refreshSessions();
      await loadSession(created.id);
    }
  }

  async function changeModel(model: DeepSeekModel) {
    setSettingsStatus(await window.agentAPI.settings.setModel(model));
  }

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy || !detail) return;
    const sessionId = detail.session.id;
    const optimistic: MessageRecord = {
      id: `local-${Date.now()}`,
      sessionId,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      artifactIds: []
    };
    setDetail((current) => (current ? { ...current, messages: [...current.messages, optimistic] } : current));
    setInput("");
    setBusy(true);
    setFollowOutput(true);
    setShowJumpToBottom(false);
    setStatusText("");
    try {
      await window.agentAPI.chat.sendMessage(sessionId, trimmed);
      await refreshSessions();
      await loadSession(sessionId);
    } catch (error) {
      setDetail((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: `error-${Date.now()}`,
                  sessionId,
                  role: "assistant",
                  content: error instanceof Error ? error.message : String(error),
                  createdAt: new Date().toISOString(),
                  artifactIds: []
                }
              ]
            }
          : current
      );
    } finally {
      setBusy(false);
      setCanceling(false);
      setStatusText("");
    }
  }

  async function cancelCurrentRun() {
    if (!detail || canceling) return;
    setCanceling(true);
    setStatusText("正在停止当前生成...");
    const canceled = await window.agentAPI.chat.cancel(detail.session.id);
    if (!canceled) {
      setBusy(false);
      setCanceling(false);
      setStatusText("");
    }
  }

  if (loadError) {
    return <div className="fatal-error">{loadError}</div>;
  }

  return (
    <div className="app-shell">
      {!settingsStatus?.hasApiKey && (
        <ApiKeyModal
          status={settingsStatus}
          onSaved={(next) => {
            setSettingsStatus(next);
          }}
        />
      )}
      <aside className="sidebar">
        <div className="sidebar-title">
          <PanelLeft size={18} />
          <span>Agent WebUI</span>
        </div>
        <button className="new-chat-button" onClick={newSession}>
          <MessageSquarePlus size={16} />
          新文献调研
        </button>
        <div className="session-groups">
          {groupSessions(sessions).map(([group, items]) => (
            <section className="session-group" key={group}>
              <div className="group-label">{group}</div>
              {items.map((session) => (
                <div
                  className={`session-item ${session.id === currentSessionId ? "active" : ""}`}
                  key={session.id}
                  onClick={() => loadSession(session.id)}
                >
                  <div className="session-copy">
                    <span>{session.title}</span>
                    <small>{formatTime(session.updatedAt)}</small>
                  </div>
                  <button
                    title="删除会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteSession(session.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="sidebar-footer">
          <Settings size={15} />
          <select value={settingsStatus?.model || "deepseek-v4-pro"} onChange={(e) => changeModel(e.target.value as DeepSeekModel)}>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
          </select>
        </div>
      </aside>
      <main className="chat-main">
        <header className="chat-header">
          <div>
            <h1>{detail?.session.title || "文献调研"}</h1>
            <p>
              DeepSeek · literature-research ·{" "}
              {detail?.session.researchStage === "idle"
                ? "等待课题"
                : detail?.session.researchStage === "clarifying"
                  ? "正在澄清范围"
                  : detail?.session.researchStage === "researching"
                    ? "调研中"
                    : "已生成报告"}
            </p>
          </div>
        </header>
        <section className="message-list" ref={messageListRef} onScroll={handleMessageScroll}>
          {!detail?.messages.length && (
            <div className="empty-state">
              <h2>告诉我你想调研的课题</h2>
              <p>我会先帮你把范围问清楚，然后检索论文，最后输出 Markdown 和 PDF 调研报告。</p>
            </div>
          )}
          {detail?.messages.map((message) => {
            const artifacts = message.artifactIds.map((id) => artifactsById.get(id)).filter(Boolean) as ArtifactRecord[];
            return (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-avatar">{message.role === "user" ? "你" : "AI"}</div>
                <div className="message-body">
                  <MarkdownView content={message.content} />
                  <ArtifactButtons artifacts={artifacts} />
                </div>
              </article>
            );
          })}
          {statusText && (
            <div className="status-line">
              <Loader2 className="spin" size={16} />
              {statusText}
            </div>
          )}
          <div ref={scrollRef} />
        </section>
        {showJumpToBottom && (
          <button
            className="jump-bottom-button"
            title="回到底部"
            onClick={() => {
              setFollowOutput(true);
              setShowJumpToBottom(false);
              scrollToBottom();
            }}
          >
            ↓
          </button>
        )}
        <footer className="composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              detail?.session.researchStage === "clarifying"
                ? "回答这些澄清问题，AI 将开始检索并生成报告..."
                : "输入你要调研的课题..."
            }
            disabled={busy || !settingsStatus?.hasApiKey}
          />
          <button
            className={`send-button ${busy ? "stop" : ""}`}
            title={busy ? "停止当前生成" : "发送"}
            disabled={(!busy && !input.trim()) || !settingsStatus?.hasApiKey || canceling}
            onClick={busy ? cancelCurrentRun : send}
          >
            {busy ? <Square size={16} fill="currentColor" /> : <Send size={18} />}
          </button>
        </footer>
      </main>
    </div>
  );
}
