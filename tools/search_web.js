import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const TAVILY_KEY = () =>
  process.env.TAVILY_API_KEY ??
  "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";

export const SearchWebTool = new DynamicStructuredTool({
  name       : "search_web",
  description:
    "Cari informasi terkini di internet menggunakan Tavily Search. " +
    "Gunakan untuk pertanyaan faktual, berita terbaru, dokumentasi, atau " +
    "topik yang memerlukan data dari luar pengetahuan model. " +
    "Mengembalikan top-5 sumber + ringkasan sintesis beserta URL referensi.",
  schema: z.object({
    query: z.string().describe(
      "Query pencarian. Tulis dalam bahasa yang paling relevan dengan topik (Indonesia atau Inggris)."
    ),
    topic: z
      .enum(["general", "news"])
      .optional()
      .default("general")
      .describe("Gunakan 'news' untuk berita terkini, 'general' untuk informasi umum."),
  }),
  func: async ({ query, topic = "general" }) => {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method : "POST",
        headers: {
          "Content-Type" : "application/json",
          "Authorization": `Bearer ${TAVILY_KEY()}`,
        },
        body: JSON.stringify({
          query,
          topic,
          search_depth       : "advanced",
          max_results        : 5,
          include_answer     : true,
          include_raw_content: false,
        }),
      });

      if (!response.ok)
        return `❌ Tavily Error ${response.status}: ${response.statusText}`;

      const data = await response.json();

      if (!data.results?.length)
        return `⚠️ Tidak ada hasil untuk query: "${query}"`;

      const lines = [];

      // Jawaban sintesis Tavily
      if (data.answer) {
        lines.push("## Ringkasan Jawaban");
        lines.push(data.answer);
        lines.push("");
      }

      // Top-5 hasil detail
      lines.push("## Sumber Detail");
      data.results.forEach((r, i) => {
        lines.push(`### [${i + 1}] ${r.title ?? "(tanpa judul)"}`);
        lines.push(`URL   : ${r.url}`);
        lines.push(`Skor  : ${(r.score ?? 0).toFixed(3)}`);
        const snippet = (r.content ?? "").slice(0, 800);
        lines.push(`Konten: ${snippet}${(r.content?.length ?? 0) > 800 ? "…" : ""}`);
        lines.push("");
      });

      return lines.join("\n");
    } catch (err) {
      return `❌ search_web gagal: ${err.message}`;
    }
  },
});
