import fs from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const ROOT_DIR = path.resolve(process.cwd());

// Base URL dari environment, fallback ke Replit app
const BASE_URL = process.env.EMORA_HUB+"/api"

export const emoraHubTool = new DynamicStructuredTool({
  name: "emora_hub",
  description: "Akses ke EMORA Community Hub untuk mencari, mendownload tool/skill ke folder 'download/', atau meng-upload tool/skill baru dalam format .zip.",
  
  schema: z.object({
    action: z.enum([
      "get_popular_tools", 
      "get_popular_skills", 
      "search_tools", 
      "search_skills",
      "download_item",
      "upload_item"
    ]),
    query: z.string().optional(),
    download_url: z.string().optional(),
    item_type: z.enum(["tool", "skill"]).optional(),
    item_name: z.string().optional(),
    api_key: z.string().optional(),
    description: z.string().optional(),
    tags: z.string().optional(),
    file_path: z.string().optional()
  }),

  func: async ({ action, query, download_url, item_type, item_name, api_key, description, tags, file_path }) => {
    try {
      let url = "";
      switch (action) {
        case "get_popular_tools": 
          url = `${BASE_URL}/getpopulartools`; 
          break;
        case "get_popular_skills": 
          url = `${BASE_URL}/getpopularskill`; 
          break;
        case "search_tools":
          if (!query) return "❌ Error: 'query' wajib.";
          url = `${BASE_URL}/searchtool?q=${encodeURIComponent(query)}`;
          break;
        case "search_skills":
          if (!query) return "❌ Error: 'query' wajib.";
          url = `${BASE_URL}/searchskill?q=${encodeURIComponent(query)}`;
          break;
        
        case "download_item":
          if (!download_url || !item_type || !item_name) {
            return "❌ Error: Data tidak lengkap. Butuh 'download_url', 'item_type', dan 'item_name'.";
          }
          
          // Jika download_url relatif, tambahkan BASE_URL
          let fullUrl = download_url;
          if (download_url.startsWith("/")) {
            fullUrl = `${BASE_URL}${download_url}`;
          }
          
          // Handle localhost
          if (fullUrl.includes("localhost")) {
            fullUrl = fullUrl.replace("localhost", "127.0.0.1");
          }
          
          const res = await fetch(fullUrl);
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Fetch error ${res.status}: ${errText}`);
          }
          
          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          const downloadDir = path.join(ROOT_DIR, "download");
          if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
          
          const safeFileName = item_name.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
          const dlFilePath = path.join(downloadDir, `${safeFileName}.zip`);
          
          fs.writeFileSync(dlFilePath, buffer);
          
          return `✅ File ZIP berhasil didownload ke '${dlFilePath}'. SEKARANG: Kamu WAJIB menggunakan project_manager untuk mengeksekusi proses instalasi (ekstrak, pindah, registrasi) sesuai EMORA HUB INSTALLATION PROTOCOL di AGENT.md. Gunakan nama direktori tujuan '${safeFileName}'.`;

        case "upload_item":
          if (!api_key || !item_type || !description || !tags || !file_path) {
            return "❌ Error: Data upload tidak lengkap. Butuh 'api_key', 'item_type' (tool/skill), 'description', 'tags', dan 'file_path'.";
          }

          const absoluteFilePath = path.resolve(ROOT_DIR, file_path);
          if (!fs.existsSync(absoluteFilePath)) {
            return `❌ Error: File ZIP tidak ditemukan di '${absoluteFilePath}'. Pastikan file sudah terbuat sebelum di-upload.`;
          }

          const fileBufferUpload = fs.readFileSync(absoluteFilePath);
          const fileBlob = new Blob([fileBufferUpload]);
          
          const formData = new FormData();
          
          // Map tipe: "tool" -> "tools", "skill" -> "skills"
          const uploadTipe = item_type === "tool" ? "tools" : "skills";
          
          formData.append("tipe", uploadTipe);
          // Tambahkan name jika diberikan, jika tidak default dari nama file
          if (item_name) {
            formData.append("name", item_name);
          }
          formData.append("description", description);
          formData.append("tags", tags);
          formData.append("file", fileBlob, path.basename(absoluteFilePath));

          const postUrl = `${BASE_URL}/post?apikey=${encodeURIComponent(api_key)}`;
          
          const uploadRes = await fetch(postUrl, {
            method: "POST",
            body: formData
          });

          if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`Upload error ${uploadRes.status}: ${errText}`);
          }

          const result = await uploadRes.json();
          if (result.success && result.data) {
            const { id, name, slug, version, installCmd } = result.data;
            return `✅ Upload berhasil!\n📦 ID: ${id}\n📛 Nama: ${name} (${slug})\n🔖 Versi: ${version}\n📥 Install: ${installCmd}`;
          } else {
            return `⚠️ Upload berhasil tapi respons tidak lengkap: ${JSON.stringify(result)}`;
          }
      }

      // Untuk aksi get/search
      const response = await fetch(url);
      if (!response.ok) {
        return `❌ Gagal menghubungi API (Status: ${response.status}).`;
      }
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        return `ℹ️ Tidak ada hasil.`;
      }

      let resultText = `✅ **Hasil EMORA Hub:**\n`;
      data.data.forEach((item, idx) => {
        // Pastikan field download ada, jika tidak buat sendiri
        let downloadPath = item.download || `/download/${item_type === 'tool' ? 'tools' : 'skill'}/${item.id}`;
        if (downloadPath.startsWith("/")) {
          downloadPath = `${BASE_URL}${downloadPath}`;
        }
        resultText += `${idx + 1}. **${item.name}** (ID: ${item.id}) | ❤️ ${item.like || 0}\n`;
        resultText += `   📖 Deskripsi: ${item.description || 'Tidak ada deskripsi'}\n`;
        resultText += `   📥 URL Download: \`${downloadPath}\`\n`;
        if (item.installCmd) {
          resultText += `   📦 Install: \`${item.installCmd}\`\n`;
        }
        resultText += `\n`;
      });
      return resultText;

    } catch (err) {
      return `❌ Error emora_hub: ${err.message} ${err.cause ? `(Penyebab: ${err.cause.message})` : ""}`;
    }
  },
});

export default emoraHubTool;