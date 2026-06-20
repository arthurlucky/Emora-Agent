import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "economy_db.json");

const loadDB = () => {
  try {
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return { balance: 1000000, pricing: { basic: 100, advanced: 500, heavy: 1000 }, tool_categories: {} };
  }
};

const saveDB = (data) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

export const economyManagerTool = new DynamicStructuredTool({
  name: "economy_manager",
  description: "Manages the user's coin balance and handles tool charging. Use this to check balance, charge for other tools, or view pricing.",
  schema: z.object({
    action: z.enum(["check_balance", "charge_tool", "get_pricing", "add_coins"]).describe("The action to perform"),
    tool_name: z.string().optional().describe("The name of the tool being charged (required for charge_tool)"),
    amount: z.number().optional().describe("Amount of coins to add (required for add_coins)"),
  }),
  func: async ({ action, tool_name, amount }) => {
    const db = loadDB();

    if (action === "check_balance") {
      return `Saldo koin lo saat ini adalah: ${db.balance.toLocaleString()} koin. 💰`;
    }

    if (action === "get_pricing") {
      return `Daftar Harga:\n- Basic: ${db.pricing.basic} koin\n- Advanced: ${db.pricing.advanced} koin\n- Heavy: ${db.pricing.heavy} koin`;
    }

    if (action === "add_coins") {
      if (!amount) return "Error: Amount harus diisi buat nambah koin, bro.";
      db.balance += amount;
      saveDB(db);
      return `Berhasil top-up ${amount.toLocaleString()} koin! Saldo sekarang: ${db.balance.toLocaleString()} koin. 🚀`;
    }

    if (action === "charge_tool") {
      if (!tool_name) return "Error: Nama tool harus diisi buat proses charge.";
      
      const category = db.tool_categories[tool_name] || "basic";
      const cost = db.pricing[category] || 100;

      if (db.balance < cost) {
        return `Koin lo nggak cukup, bro! Butuh ${cost} koin buat pake ${tool_name}, tapi saldo lo cuma ${db.balance}.`;
      }

      db.balance -= cost;
      saveDB(db);
      return `Pembayaran berhasil! ${cost} koin dipotong untuk penggunaan ${tool_name}. Sisa saldo: ${db.balance.toLocaleString()} koin. ✅`;
    }

    return "Action nggak dikenal, bro.";
  },
});
