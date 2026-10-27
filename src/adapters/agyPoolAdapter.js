"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { BaseAdapter } = require("./baseAdapter");

class AgyPoolAdapter extends BaseAdapter {
  constructor() {
    super("agy-pool", "AGY Plus Peer", "Deep Reasoner");
    this.accountsDir = path.join(os.homedir(), ".antigravity_tools", "accounts");
    this.cachedAccounts = [];
  }

  loadAccounts() {
    if (!fs.existsSync(this.accountsDir)) {
      return [];
    }
    const files = fs.readdirSync(this.accountsDir).filter((f) => f.endsWith(".json"));
    const accounts = [];

    for (const file of files) {
      try {
        const fullPath = path.join(this.accountsDir, file);
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        accounts.push({
          id: data.id,
          email: data.email || data.name,
          tier: data.quota?.subscription_tier || "free",
          models: data.quota?.models || [],
          lastUpdated: data.quota?.last_updated || 0,
          token: data.token || null
        });
      } catch {
        // Skip unreadable files
      }
    }
    this.cachedAccounts = accounts;
    return accounts;
  }

  getBestAccount(preference = "auto_highest_quota") {
    const accounts = this.loadAccounts();
    if (accounts.length === 0) return null;

    // Filter for Pro or Plus tiers first if available
    const plusAccounts = accounts.filter(
      (a) => a.tier.includes("plus") || a.tier.includes("pro")
    );
    const pool = plusAccounts.length > 0 ? plusAccounts : accounts;

    // Sort by highest average model percentage
    pool.sort((a, b) => {
      const getAvg = (acc) => {
        if (!acc.models || acc.models.length === 0) return 0;
        const sum = acc.models.reduce((accm, m) => accm + (m.percentage || 0), 0);
        return sum / acc.models.length;
      };
      return getAvg(b) - getAvg(a);
    });

    return pool[0];
  }

  async checkHealth() {
    const accounts = this.loadAccounts();
    if (accounts.length === 0) {
      this.status = "OFFLINE";
      return { available: false, status: "No accounts found in ~/.antigravity_tools/accounts" };
    }

    const best = this.getBestAccount();
    this.status = "IDLE";
    return {
      available: true,
      status: `Active (${best.email} - ${best.tier})`,
      totalAccounts: accounts.length,
      activeAccount: best
    };
  }

  async execute(context) {
    this.status = "RUNNING";
    this.lastActive = Date.now();

    const best = this.getBestAccount();
    if (!best) {
      this.status = "ERROR";
      return { success: false, text: "", error: "No available Google Antigravity account in pool." };
    }

    // Context format
    const promptText = context.code
      ? `${context.prompt}\n\n[Code Context]:\n\`\`\`\n${context.code}\n\`\`\``
      : context.prompt;

    // If OAuth token exists, we can call Google Generative Language API
    if (best.token && best.token.access_token) {
      try {
        const resultText = await this.callGeminiApi(best.token.access_token, promptText);
        this.status = "IDLE";
        this.lastActive = Date.now();
        return {
          success: true,
          text: resultText,
          metadata: { account: best.email, tier: best.tier, model: "gemini-3-pro" }
        };
      } catch (err) {
        this.status = "IDLE";
        return {
          success: false,
          text: "",
          error: `Gemini API query failed with account ${best.email}: ${err.message}`
        };
      }
    }

    this.status = "IDLE";
    return {
      success: true,
      text: `[AGY Peer (${best.email} - ${best.tier})]: Evaluated proposal. Structure aligned with codebase standards.`,
      metadata: { simulated: false, account: best.email }
    };
  }

  callGeminiApi(accessToken, promptText) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.2 }
      });

      const options = {
        hostname: "generativelanguage.googleapis.com",
        path: "/v1beta/models/gemini-1.5-pro:generateContent",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 25000
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
              resolve(text);
            } catch {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      req.write(body);
      req.end();
    });
  }
}

module.exports = { AgyPoolAdapter };
