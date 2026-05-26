import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

interface SkillInfo {
  name: string;
  description: string;
  body: string;
}

function parseSkillMarkdown(markdown: string): SkillInfo {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = match?.[1] || "";
  const body = match?.[2] || markdown;
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "unknown";
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
  return { name, description, body };
}

export class SkillLoader {
  private skills: SkillInfo[] = [];

  load() {
    const root = path.join(app.getAppPath(), "literature-research");
    const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { skills: string[] };
    this.skills = manifest.skills.map((relativeSkillPath) => {
      const skillPath = path.join(root, relativeSkillPath, "SKILL.md");
      return parseSkillMarkdown(fs.readFileSync(skillPath, "utf8"));
    });
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
    const chosen = preferred
      .map((name) => this.skills.find((skill) => skill.name === name))
      .filter(Boolean) as SkillInfo[];

    const skillBlocks = chosen
      .map((skill) => {
        const excerpt = skill.body.replace(/\n{3,}/g, "\n\n").slice(0, 3200);
        return `## Skill: ${skill.name}\nDescription: ${skill.description}\n\n${excerpt}`;
      })
      .join("\n\n---\n\n");

    return `你正在使用 literature-research 技能集进行学术文献调研。以下是本次任务要遵循的技能指令摘要：\n\n${skillBlocks}\n\n执行原则：\n- 优先用 Semantic Scholar 检索论文元数据。\n- 不要编造不存在的论文、DOI、作者、期刊或实验结果。\n- 缺少摘要、TLDR 或全文时，必须标注证据不足。\n- 面向不熟悉文献调研的使用人，先澄清范围，再给出可读、结构化、可下载的最终报告。\n- 最终报告必须有总结性结论、代表性文献表、证据强度、研究空白和参考文献。`;
  }
}
