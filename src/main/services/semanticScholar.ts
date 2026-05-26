import type { SemanticPaper } from "../../shared/types";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const FIELDS = [
  "paperId",
  "title",
  "abstract",
  "authors",
  "year",
  "citationCount",
  "referenceCount",
  "venue",
  "publicationDate",
  "openAccessPdf",
  "tldr",
  "externalIds"
].join(",");

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function paperUrl(paper: SemanticPaper) {
  if (paper.externalIds?.DOI) {
    return `https://doi.org/${paper.externalIds.DOI}`;
  }
  return `https://www.semanticscholar.org/paper/${paper.paperId}`;
}

export class SemanticScholarService {
  async search(query: string, limit = 20): Promise<SemanticPaper[]> {
    const params = new URLSearchParams({
      query,
      limit: String(Math.min(Math.max(limit, 1), 100)),
      fields: FIELDS,
      sort: "citationCount:desc"
    });
    const response = await fetch(`${BASE_URL}/paper/search?${params.toString()}`);
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Semantic Scholar 当前限流了，请稍后继续调研。");
      }
      throw new Error(`Semantic Scholar 检索失败 (${response.status})：${body.slice(0, 300)}`);
    }
    const payload = JSON.parse(body) as { data?: SemanticPaper[] };
    return this.dedupe(payload.data || []).slice(0, limit);
  }

  formatForPrompt(papers: SemanticPaper[]) {
    return papers
      .map((paper, index) => {
        const authors = (paper.authors || [])
          .slice(0, 5)
          .map((author) => author.name)
          .join(", ");
        const summary = paper.tldr?.text || paper.abstract || "No abstract or TLDR available.";
        return [
          `### [${index + 1}] ${paper.title}`,
          `Authors: ${authors || "Unknown"}`,
          `Year: ${paper.year || "Unknown"} | Venue: ${paper.venue || "Unknown"} | Citations: ${
            paper.citationCount ?? 0
          }`,
          `URL: ${paperUrl(paper)}`,
          `Summary: ${summary.slice(0, 1300)}`
        ].join("\n");
      })
      .join("\n\n");
  }

  private dedupe(papers: SemanticPaper[]) {
    const seen = new Set<string>();
    const deduped: SemanticPaper[] = [];
    for (const paper of papers) {
      const doi = String(paper.externalIds?.DOI || "").toLowerCase();
      const key = doi || normalizeTitle(paper.title || "");
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(paper);
    }
    return deduped.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
  }
}
