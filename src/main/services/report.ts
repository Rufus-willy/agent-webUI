import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, app } from "electron";

function sanitizeFileName(input: string) {
  return input
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "literature-research-report";
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(input: string) {
  return escapeHtml(input)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  let table: string[] = [];

  const flushList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  const flushTable = () => {
    if (!table.length) {
      return;
    }
    const rows = table.filter((line) => !/^\|\s*-+/.test(line));
    html.push("<table>");
    rows.forEach((row, rowIndex) => {
      const cells = row
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim());
      html.push("<tr>");
      cells.forEach((cell) => {
        html.push(rowIndex === 0 ? `<th>${inlineMarkdown(cell)}</th>` : `<td>${inlineMarkdown(cell)}</td>`);
      });
      html.push("</tr>");
    });
    html.push("</table>");
    table = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushList();
      flushTable();
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (/^\|.+\|$/.test(line.trim())) {
      flushList();
      table.push(line.trim());
      continue;
    }
    flushTable();
    if (!line.trim()) {
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    flushList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  flushList();
  flushTable();
  return html.join("\n");
}

export class ReportService {
  getReportsDir() {
    const reportsDir = path.join(app.getPath("userData"), "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    return reportsDir;
  }

  async writeReportFiles(title: string, markdown: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${sanitizeFileName(title)}-${stamp}`;
    const markdownPath = path.join(this.getReportsDir(), `${baseName}.md`);
    const pdfPath = path.join(this.getReportsDir(), `${baseName}.pdf`);
    fs.writeFileSync(markdownPath, markdown, "utf8");
    await this.writePdf(pdfPath, markdown, title);
    return { markdownPath, pdfPath };
  }

  private async writePdf(filePath: string, markdown: string, title: string) {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        background: #ffffff;
      }
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      html {
        background: #ffffff;
      }
      body {
        margin: 0;
        background: #ffffff;
        color: #182026;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.58;
        padding: 34px 42px;
      }
      h1, h2, h3, h4 { color: #0d1b2a; line-height: 1.25; margin-top: 24px; }
      h1 { font-size: 28px; border-bottom: 1px solid #d9e2ec; padding-bottom: 12px; }
      h2 { font-size: 20px; }
      h3 { font-size: 16px; }
      table { border-collapse: collapse; width: 100%; margin: 14px 0 20px; table-layout: fixed; }
      th, td { border: 1px solid #d8dee8; padding: 8px 9px; vertical-align: top; word-break: break-word; }
      th { background: #edf2f7; }
      code { background: #edf2f7; padding: 1px 4px; border-radius: 4px; }
      pre { background: #111827; color: #f9fafb; padding: 12px; border-radius: 8px; white-space: pre-wrap; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>${markdownToHtml(markdown)}</body>
</html>`;
    const win = new BrowserWindow({
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: { sandbox: true }
    });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        margins: { marginType: "custom", top: 0.25, bottom: 0.25, left: 0.25, right: 0.25 }
      });
      fs.writeFileSync(filePath, pdf);
    } finally {
      win.destroy();
    }
  }
}
