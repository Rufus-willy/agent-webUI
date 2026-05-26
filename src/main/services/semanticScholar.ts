import type { SemanticPaper } from "../../shared/types";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const OPENALEX_URL = "https://api.openalex.org/works";
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

interface LiteratureSearchResult {
  papers: SemanticPaper[];
  note: string;
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  display_name?: string;
  title?: string;
  publication_year?: number | null;
  publication_date?: string | null;
  cited_by_count?: number | null;
  referenced_works_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    source?: { display_name?: string | null } | null;
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
  authorships?: Array<{ author?: { id?: string | null; display_name?: string | null } | null }>;
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reconstructOpenAlexAbstract(index?: Record<string, number[]> | null) {
  if (!index) {
    return null;
  }
  const positioned: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      positioned.push([position, word]);
    }
  }
  return positioned
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(" ");
}

export function paperUrl(paper: SemanticPaper) {
  if (paper.externalIds?.DOI) {
    return `https://doi.org/${paper.externalIds.DOI}`;
  }
  if (paper.externalIds?.OpenAlex) {
    return String(paper.externalIds.OpenAlex);
  }
  return `https://www.semanticscholar.org/paper/${paper.paperId}`;
}

export class SemanticScholarService {
  async searchWithFallback(query: string, limit = 24): Promise<LiteratureSearchResult> {
    const notes: string[] = [];
    try {
      const papers = await this.search(query, limit);
      notes.push(`Semantic Scholar returned ${papers.length} papers for query: ${query}`);
      if (papers.length) {
        return { papers, note: notes.join("\n") };
      }
    } catch (error) {
      notes.push(`Semantic Scholar failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const papers = await this.searchOpenAlex(query, limit);
      notes.push(`OpenAlex fallback returned ${papers.length} papers for query: ${query}`);
      return { papers, note: notes.join("\n") };
    } catch (error) {
      notes.push(`OpenAlex fallback failed: ${error instanceof Error ? error.message : String(error)}`);
      return { papers: [], note: notes.join("\n") };
    }
  }

  async search(query: string, limit = 20): Promise<SemanticPaper[]> {
    const params = new URLSearchParams({
      query,
      limit: String(Math.min(Math.max(limit, 1), 100)),
      fields: FIELDS,
      sort: "citationCount:desc"
    });
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${BASE_URL}/paper/search?${params.toString()}`);
      const body = await response.text();
      if (response.ok) {
        const payload = JSON.parse(body) as { data?: SemanticPaper[] };
        return this.dedupe(payload.data || []).slice(0, limit);
      }
      lastError =
        response.status === 429
          ? "Semantic Scholar 当前限流了。"
          : `Semantic Scholar 检索失败 (${response.status})：${body.slice(0, 300)}`;
      if (response.status !== 429 || attempt === 2) {
        break;
      }
      await delay(1800 * (attempt + 1));
    }
    throw new Error(lastError || "Semantic Scholar 检索失败。");
  }

  async searchOpenAlex(query: string, limit = 24): Promise<SemanticPaper[]> {
    const params = new URLSearchParams({
      search: query,
      "per-page": String(Math.min(Math.max(limit, 1), 100)),
      sort: "cited_by_count:desc",
      filter: "from_publication_date:2019-01-01,to_publication_date:2026-12-31"
    });
    const response = await fetch(`${OPENALEX_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": "agent-webui/0.1.0 (mailto:suwenbinra@gmail.com)"
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAlex 检索失败 (${response.status})：${body.slice(0, 300)}`);
    }
    const payload = JSON.parse(body) as { results?: OpenAlexWork[] };
    const papers = (payload.results || []).map((work) => {
      const doi = work.doi?.replace(/^https?:\/\/doi.org\//i, "");
      return {
        paperId: work.id || crypto.randomUUID(),
        title: work.display_name || work.title || "Untitled",
        abstract: reconstructOpenAlexAbstract(work.abstract_inverted_index),
        authors: (work.authorships || [])
          .map((authorship) => ({
            authorId: authorship.author?.id || null,
            name: authorship.author?.display_name || "Unknown"
          }))
          .filter((author) => author.name !== "Unknown"),
        year: work.publication_year || null,
        citationCount: work.cited_by_count || 0,
        referenceCount: work.referenced_works_count || 0,
        venue: work.primary_location?.source?.display_name || null,
        publicationDate: work.publication_date || null,
        openAccessPdf: work.primary_location?.pdf_url
          ? { url: work.primary_location.pdf_url, status: "open" }
          : null,
        tldr: null,
        externalIds: {
          ...(doi ? { DOI: doi } : {}),
          ...(work.id ? { OpenAlex: work.id } : {})
        }
      } satisfies SemanticPaper;
    });
    return this.dedupe(papers).slice(0, limit);
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
