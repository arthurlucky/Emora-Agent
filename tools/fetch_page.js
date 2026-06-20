import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const TAVILY_KEY = () =>
  process.env.TAVILY_API_KEY ??
  "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";

export const FetchPageTool = new DynamicStructuredTool({
  name       : "fetch_page",
  description:
    "Baca isi lengkap sebuah halaman web berdasarkan URL menggunakan Tavily Extract. " +
    "Gunakan setelah search_web menemukan URL relevan dan kamu butuh detail lebih dalam.",
  schema: z.object({
    url: z.string().url().describe("URL lengkap halaman yang ingin dibaca."),
  }),
  func: async ({ url }) => {
    try {
      const response = await fetch("https://api.tavily.com/extract", {
        method : "POST",
        headers: {
          "Content-Type" : "application/json",
          "Authorization": `Bearer ${TAVILY_KEY()}`,
        },
        body: JSON.stringify({ urls: [url] }),
      });

      if (!response.ok)
        return `❌ Tavily Extract Error ${response.status}: ${response.statusText}`;

      const data    = await response.json();
      const pageRaw = data.results?.[0]?.raw_content ?? data.results?.[0]?.content;

      if (!pageRaw)
        return `⚠️ Tidak bisa mengambil konten dari: ${url}`;

      const trimmed = pageRaw.slice(0, 3000);
      return (
        `## Konten dari ${url}\n\n${trimmed}` +
        (pageRaw.length > 3000 ? "\n\n…(konten dipotong pada 3000 karakter)" : "")
      );
    } catch (err) {
      return `❌ fetch_page gagal: ${err.message}`;
    }
  },
});
