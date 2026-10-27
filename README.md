# Antigravity A2A Mesh (Paperclip & Obsidian)

Ekstensi resmi **Agent-to-Agent (A2A)** untuk **Antigravity IDE 2.0**, menghubungkan **Claude Code (Pro)**, **OpenAI Codex**, dan **Google Antigravity Multi-Account Pool** dalam satu tim otonom dengan sinkronisasi catatan ke **Obsidian Vault**.

---

## ⚡ Fitur Utama

1. **Paperclip Agent Squad (Group Chat)**:
   - Antarmuka obrolan tim developer di sidebar Antigravity IDE.
   - Dukungan `@mention` instan: `@Claude`, `@Codex`, `@AGY`, atau `@all`.
   - Matrix status agen real-time (Idle, Executing, Auditing) tanpa pemborosan token idle.

2. **Autonomous Council Debate**:
   - Satu instruksi memicu diskusi silang antara Claude Code (desain arsitektur) dan OpenAI Codex (audit keamanan).
   - Konsensus otomatis diterapkan ke workspace lokal.

3. **Bi-Directional Obsidian Vault Sync**:
   - Membaca pedoman arsitektur dan aturan proyek dari Vault Obsidian Anda.
   - Secara otomatis menyusun dan menyimpan **Architectural Decision Records (ADR)** dalam format Markdown murni ke `[Vault]/ADR/`.

4. **Multi-Account Quota Routing**:
   - Mendeteksi 8 akun Google Antigravity Anda dari `~/.antigravity_tools/accounts/`.
   - Otomatis merotasi akun Plus/Pro untuk tugas penalaran berat.

5. **Universal MCP Server**:
   - Mengekspos endpoint MCP stdio di `src/mcp/mcpServer.js`.
   - Chat AI Antigravity dapat memanggil squad A2A secara native via tool call.

---

## 🛠️ Perintah & Shortcut

| Perintah | Deskripsi | Shortcut |
| :--- | :--- | :--- |
| `A2A Mesh: Open Agent Squad` | Buka panel obrolan tim di sidebar | Klik ikon A2A di Activity Bar |
| `A2A Mesh: Consult Claude Architect` | Kirim kode terpilih ke Claude Code | Klik kanan di editor |
| `A2A Mesh: Security Audit with Codex` | Minta Codex audit celah keamanan pada seleksi | Klik kanan di editor |
| `A2A Mesh: Run Multi-Agent Council Debate` | Jalankan debat konsensus penuh pada fitur | `Ctrl+Alt+C` |
| `A2A Mesh: Sync Last Task to Obsidian` | Hubungkan / ganti folder Obsidian Vault | Menu Command Palette |

---

## ⚙️ Pengaturan Ekstensi

Buka `Settings` (`Ctrl+,`) lalu cari `A2A`:
* `a2a.obsidianVaultPath`: Path folder Obsidian Vault Anda (misal: `D:/Obsidian/MyVault`).
* `a2a.autoSyncObsidian`: Centang untuk auto-generate ADR saat task selesai (Default: `true`).
* `a2a.claudeCliPath`: Path binary `claude.exe` (Default: `C:\Users\acer\.local\bin\claude.exe`).
* `a2a.codexCliPath`: Path binary `codex.exe`.
