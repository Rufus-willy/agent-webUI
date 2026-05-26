import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type initSqlJsType from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import type {
  ArtifactRecord,
  DeepSeekModel,
  MessageRecord,
  ResearchStage,
  Role,
  SessionDetail,
  SessionSummary
} from "../../shared/types";

type SqlValue = string | number | Uint8Array | null;

interface SqlJsInit {
  default?: typeof initSqlJsType;
}

function nowIso() {
  return new Date().toISOString();
}

function mapSession(row: Record<string, unknown>): SessionSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    researchStage: String(row.research_stage) as ResearchStage
  };
}

function mapMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: String(row.role) as Role,
    content: String(row.content),
    createdAt: String(row.created_at),
    artifactIds: JSON.parse(String(row.artifact_ids || "[]"))
  };
}

function mapArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    kind: String(row.kind) as ArtifactRecord["kind"],
    title: String(row.title),
    filePath: String(row.file_path),
    createdAt: String(row.created_at)
  };
}

export class DatabaseService {
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private dbPath = "";

  async init() {
    const initModule = require("sql.js") as SqlJsInit | typeof initSqlJsType;
    const initSqlJs = (typeof initModule === "function" ? initModule : initModule.default) as
      | typeof initSqlJsType
      | undefined;
    if (!initSqlJs) {
      throw new Error("无法加载 sql.js。");
    }
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const wasmFile = fs.readFileSync(wasmPath);
    const wasmBinary = wasmFile.buffer.slice(
      wasmFile.byteOffset,
      wasmFile.byteOffset + wasmFile.byteLength
    ) as ArrayBuffer;
    this.SQL = await initSqlJs({ wasmBinary });

    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    this.dbPath = path.join(app.getPath("userData"), "agent-webui.sqlite");
    if (fs.existsSync(this.dbPath)) {
      this.db = new this.SQL.Database(fs.readFileSync(this.dbPath));
    } else {
      this.db = new this.SQL.Database();
    }

    this.migrate();
    this.persist();
  }

  get dataPath() {
    return this.dbPath;
  }

  getDataDir() {
    return app.getPath("userData");
  }

  listSessions(): SessionSummary[] {
    return this.all("SELECT * FROM sessions ORDER BY updated_at DESC").map(mapSession);
  }

  createSession(title = "新文献调研"): SessionSummary {
    const id = crypto.randomUUID();
    const created = nowIso();
    this.run(
      "INSERT INTO sessions (id, title, created_at, updated_at, research_stage, metadata) VALUES (?, ?, ?, ?, ?, ?)",
      [id, title, created, created, "idle", "{}"]
    );
    return this.getSession(id)!;
  }

  getSession(id: string): SessionSummary | null {
    const row = this.get("SELECT * FROM sessions WHERE id = ?", [id]);
    return row ? mapSession(row) : null;
  }

  getSessionDetail(id: string): SessionDetail {
    const session = this.getSession(id) || this.createSession();
    const messages = this.listMessages(session.id);
    const artifacts = this.listArtifacts(session.id);
    return { session, messages, artifacts };
  }

  renameSession(id: string, title: string): SessionSummary {
    this.run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [
      title.trim() || "未命名调研",
      nowIso(),
      id
    ]);
    return this.getSession(id)!;
  }

  deleteSession(id: string) {
    this.run("DELETE FROM artifacts WHERE session_id = ?", [id]);
    this.run("DELETE FROM messages WHERE session_id = ?", [id]);
    this.run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  updateSessionStage(id: string, stage: ResearchStage) {
    this.run("UPDATE sessions SET research_stage = ?, updated_at = ? WHERE id = ?", [
      stage,
      nowIso(),
      id
    ]);
  }

  touchSession(id: string) {
    this.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [nowIso(), id]);
  }

  addMessage(input: {
    id?: string;
    sessionId: string;
    role: Role;
    content: string;
    artifactIds?: string[];
  }): MessageRecord {
    const id = input.id || crypto.randomUUID();
    const created = nowIso();
    this.run(
      "INSERT INTO messages (id, session_id, role, content, created_at, artifact_ids) VALUES (?, ?, ?, ?, ?, ?)",
      [
        id,
        input.sessionId,
        input.role,
        input.content,
        created,
        JSON.stringify(input.artifactIds || [])
      ]
    );
    this.touchSession(input.sessionId);
    return this.getMessage(id)!;
  }

  updateMessage(id: string, content: string, artifactIds?: string[]) {
    this.run("UPDATE messages SET content = ?, artifact_ids = ? WHERE id = ?", [
      content,
      JSON.stringify(artifactIds || []),
      id
    ]);
  }

  getMessage(id: string): MessageRecord | null {
    const row = this.get("SELECT * FROM messages WHERE id = ?", [id]);
    return row ? mapMessage(row) : null;
  }

  listMessages(sessionId: string): MessageRecord[] {
    return this.all("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC", [
      sessionId
    ]).map(mapMessage);
  }

  addArtifact(input: {
    sessionId: string;
    kind: ArtifactRecord["kind"];
    title: string;
    filePath: string;
  }): ArtifactRecord {
    const id = crypto.randomUUID();
    const created = nowIso();
    this.run(
      "INSERT INTO artifacts (id, session_id, kind, title, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.sessionId, input.kind, input.title, input.filePath, created]
    );
    return this.getArtifact(id)!;
  }

  getArtifact(id: string): ArtifactRecord | null {
    const row = this.get("SELECT * FROM artifacts WHERE id = ?", [id]);
    return row ? mapArtifact(row) : null;
  }

  listArtifacts(sessionId: string): ArtifactRecord[] {
    return this.all("SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC", [
      sessionId
    ]).map(mapArtifact);
  }

  getSetting(key: string): string | null {
    const row = this.get("SELECT value FROM settings WHERE key = ?", [key]);
    return row ? String(row.value) : null;
  }

  setSetting(key: string, value: string) {
    this.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
  }

  getModel(): DeepSeekModel {
    const model = this.getSetting("deepseek.model");
    return model === "deepseek-v4-flash" ? "deepseek-v4-flash" : "deepseek-v4-pro";
  }

  setModel(model: DeepSeekModel) {
    this.setSetting("deepseek.model", model);
  }

  getSecret(key: string): string | null {
    const row = this.get("SELECT value FROM secrets WHERE key = ?", [key]);
    return row ? String(row.value) : null;
  }

  setSecret(key: string, value: string) {
    this.run(
      "INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
  }

  private migrate() {
    this.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        research_stage TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        artifact_ids TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
    `);

    if (!this.getSetting("deepseek.model")) {
      this.setSetting("deepseek.model", "deepseek-v4-pro");
    }
  }

  private exec(sql: string) {
    this.assertDb().exec(sql);
    this.persist();
  }

  private run(sql: string, params: SqlValue[] = []) {
    const stmt = this.assertDb().prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
    this.persist();
  }

  private get(sql: string, params: SqlValue[] = []): Record<string, unknown> | null {
    const stmt = this.assertDb().prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) {
        return null;
      }
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  private all(sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
    const stmt = this.assertDb().prepare(sql);
    const rows: Record<string, unknown>[] = [];
    try {
      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private persist() {
    if (!this.db || !this.dbPath) {
      return;
    }
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  private assertDb() {
    if (!this.db) {
      throw new Error("Database has not been initialized.");
    }
    return this.db;
  }
}
