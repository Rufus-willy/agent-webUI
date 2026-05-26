import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { SkillPackSummary } from "../../shared/types";
import { DatabaseService } from "./database";

interface SkillInfo {
  name: string;
  description: string;
  body: string;
  packName: string;
}

interface StoredSkillPack {
  id: string;
  path: string;
  active: boolean;
}

interface LoadedPack {
  summary: SkillPackSummary;
  skills: SkillInfo[];
}

const BUILTIN_PACK_ID = "builtin:literature-research";
const USER_PACKS_SETTING = "skills.userPacks";
const BUILTIN_ACTIVE_SETTING = "skills.builtin.literature-research.active";

function parseSkillMarkdown(markdown: string, packName: string): SkillInfo {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = match?.[1] || "";
  const body = match?.[2] || markdown;
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "unknown";
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
  return { name, description, body, packName };
}

function userPackId(rootPath: string) {
  return `user:${Buffer.from(path.resolve(rootPath)).toString("base64url")}`;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export class SkillLoader {
  private skills: SkillInfo[] = [];

  constructor(private readonly db: DatabaseService) {}

  load() {
    this.skills = this.getAllPacks()
      .filter((pack) => pack.summary.active)
      .flatMap((pack) => pack.skills);
  }

  listPacks(): SkillPackSummary[] {
    return this.getAllPacks().map((pack) => pack.summary);
  }

  addPack(inputPath: string): SkillPackSummary {
    const rootPath = this.resolvePackRoot(inputPath);
    const loaded = this.loadPack(rootPath, {
      id: userPackId(rootPath),
      builtIn: false,
      active: true
    });
    if (!loaded.skills.length) {
      throw new Error("这个目录里没有找到可加载的 SKILL.md。");
    }

    const packs = this.getStoredUserPacks();
    const next = [
      ...packs.filter((pack) => pack.id !== loaded.summary.id),
      { id: loaded.summary.id, path: rootPath, active: true }
    ];
    this.setStoredUserPacks(next);
    this.load();
    return loaded.summary;
  }

  setPackActive(id: string, active: boolean): SkillPackSummary[] {
    if (id === BUILTIN_PACK_ID) {
      this.db.setSetting(BUILTIN_ACTIVE_SETTING, active ? "true" : "false");
    } else {
      const packs = this.getStoredUserPacks().map((pack) =>
        pack.id === id ? { ...pack, active } : pack
      );
      this.setStoredUserPacks(packs);
    }
    this.load();
    return this.listPacks();
  }

  getResearchPrompt() {
    if (!this.skills.length) {
      this.load();
    }

    const preferred = [
      "semantic-scholar",
      "paper-reader",
      "evidence-synthesis",
      "research-gaps",
      "annotated-bibliography"
    ];
    const preferredSkills = preferred
      .map((name) => this.skills.find((skill) => skill.name === name))
      .filter(Boolean) as SkillInfo[];
    const preferredNames = new Set(preferredSkills.map((skill) => skill.name));
    const otherActiveSkills = this.skills.filter((skill) => !preferredNames.has(skill.name));
    const chosen = [...preferredSkills, ...otherActiveSkills].slice(0, 12);

    if (!chosen.length) {
      return `当前没有启用专用 skills。请按通用学术文献调研助手方式工作：先澄清问题，再检索论文，最后输出结构化总结报告；不要编造不存在的论文、DOI、作者、期刊或实验结果。`;
    }

    const activePackNames = Array.from(new Set(chosen.map((skill) => skill.packName))).join(", ");
    const skillBlocks = chosen
      .map((skill) => {
        const excerpt = skill.body.replace(/\n{3,}/g, "\n\n").slice(0, 2400);
        return `## Skill: ${skill.name}\nPack: ${skill.packName}\nDescription: ${skill.description}\n\n${excerpt}`;
      })
      .join("\n\n---\n\n");

    return `你正在使用已激活的 skills 进行学术文献调研。当前激活技能包：${activePackNames}。\n\n以下是本次任务要遵循的技能指令摘要：\n\n${skillBlocks}\n\n执行原则：\n- 优先用 Semantic Scholar 检索论文元数据；如限流或失败，使用 OpenAlex 兜底。\n- 不要编造不存在的论文、DOI、作者、期刊或实验结果。\n- 缺少摘要、TLDR 或全文时，必须标注证据不足。\n- 面向不熟悉文献调研的使用人，先澄清范围，再给出可读、结构化、可下载的最终报告。\n- 最终报告必须有总结性结论、代表性文献表、证据强度、研究空白和参考文献。`;
  }

  private getAllPacks(): LoadedPack[] {
    const packs: LoadedPack[] = [];
    const builtInRoot = this.findBuiltInRoot();
    if (fs.existsSync(builtInRoot)) {
      packs.push(
        this.loadPack(builtInRoot, {
          id: BUILTIN_PACK_ID,
          builtIn: true,
          active: this.db.getSetting(BUILTIN_ACTIVE_SETTING) !== "false"
        })
      );
    }

    for (const pack of this.getStoredUserPacks()) {
      if (!fs.existsSync(pack.path)) {
        packs.push({
          summary: {
            id: pack.id,
            name: path.basename(pack.path),
            path: pack.path,
            active: pack.active,
            builtIn: false,
            skillCount: 0,
            description: "目录不存在，请重新添加。"
          },
          skills: []
        });
        continue;
      }
      packs.push(this.loadPack(pack.path, { id: pack.id, builtIn: false, active: pack.active }));
    }

    return packs;
  }

  private findBuiltInRoot() {
    const candidates = [
      path.join(app.getAppPath(), "literature-research"),
      path.resolve(process.cwd(), "literature-research"),
      path.resolve(__dirname, "..", "..", "..", "literature-research")
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  private loadPack(
    rootPath: string,
    options: { id: string; builtIn: boolean; active: boolean }
  ): LoadedPack {
    const manifestPath = path.join(rootPath, ".claude-plugin", "plugin.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = readJson<{
        name?: string;
        description?: string;
        skills?: string[];
      }>(manifestPath);
      const packName = manifest.name || path.basename(rootPath);
      const skills = (manifest.skills || [])
        .map((relativeSkillPath) => path.join(rootPath, relativeSkillPath, "SKILL.md"))
        .filter((skillPath) => fs.existsSync(skillPath))
        .map((skillPath) => parseSkillMarkdown(fs.readFileSync(skillPath, "utf8"), packName));
      return {
        summary: {
          id: options.id,
          name: packName,
          path: rootPath,
          active: options.active,
          builtIn: options.builtIn,
          skillCount: skills.length,
          description: manifest.description
        },
        skills
      };
    }

    const singleSkillPath = path.join(rootPath, "SKILL.md");
    if (fs.existsSync(singleSkillPath)) {
      const packName = path.basename(rootPath);
      const skill = parseSkillMarkdown(fs.readFileSync(singleSkillPath, "utf8"), packName);
      return {
        summary: {
          id: options.id,
          name: skill.name || packName,
          path: rootPath,
          active: options.active,
          builtIn: options.builtIn,
          skillCount: 1,
          description: skill.description
        },
        skills: [skill]
      };
    }

    const skillsRoot = path.join(rootPath, "skills");
    const skills = fs.existsSync(skillsRoot)
      ? fs
          .readdirSync(skillsRoot)
          .map((entry) => path.join(skillsRoot, entry, "SKILL.md"))
          .filter((skillPath) => fs.existsSync(skillPath))
          .map((skillPath) => parseSkillMarkdown(fs.readFileSync(skillPath, "utf8"), path.basename(rootPath)))
      : [];

    return {
      summary: {
        id: options.id,
        name: path.basename(rootPath),
        path: rootPath,
        active: options.active,
        builtIn: options.builtIn,
        skillCount: skills.length
      },
      skills
    };
  }

  private resolvePackRoot(inputPath: string) {
    const resolved = path.resolve(inputPath);
    if (path.basename(resolved) === ".claude-plugin" && fs.existsSync(path.join(resolved, "plugin.json"))) {
      return path.dirname(resolved);
    }
    return resolved;
  }

  private getStoredUserPacks(): StoredSkillPack[] {
    const raw = this.db.getSetting(USER_PACKS_SETTING);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as StoredSkillPack[];
      return parsed.filter((pack) => pack.id && pack.path);
    } catch {
      return [];
    }
  }

  private setStoredUserPacks(packs: StoredSkillPack[]) {
    this.db.setSetting(USER_PACKS_SETTING, JSON.stringify(packs));
  }
}
