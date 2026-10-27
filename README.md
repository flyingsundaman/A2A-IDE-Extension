# A2A Workspace

Extension untuk IDE yang kompatibel dengan VS Code **1.85+**. Empat halaman untuk mengatur agent dan koneksi, memilih knowledge dan skill, berbicara dengan agent, serta memantau pekerjaan bertahap. Navigasi memakai teks tanpa ikon atau emoji.

## Pasang dan mulai

1. Pasang file `antigravity-a2a-mesh-2.0.0.vsix` melalui **Extensions: Install from VSIX…**, lalu reload IDE jika diminta.
2. Buka folder proyek dan jalankan **A2A: Open Workspace** dari Command Palette. Panel A2A juga tersedia di area panel IDE; **Open in editor** membuka tampilan yang lebih luas.
3. Pada **Agents & Connections**, pilih **Use local login** untuk mendeteksi Codex atau Claude Code yang terpasang. Ini menambahkan koneksi dan agent read-only. Pilih **Test** untuk memeriksa sesi, atau **Login** untuk menjalankan login resmi melalui terminal.
4. Alternatifnya, tambahkan koneksi API, simpan, lalu pilih **Set key**. Credential dimasukkan melalui prompt rahasia IDE, bukan melalui form webview. **Test** memeriksa akses daftar model; keberhasilan inference tetap diperiksa saat agent dijalankan.
5. Buat agent: pilih koneksi, nama, role, model, instruksi, serta izin skill dan connector. Agent API harus memiliki model ID. Gunakan hasil discovery atau ketik model yang tersedia di akun Anda.
6. Buka **Chat** untuk percakapan atau **Tasks** untuk menyusun urutan agent. Setiap tahap menerima hasil tahap sebelumnya.

CLI dan file berjalan pada mesin tempat extension host berada. Pada remote workspace, CLI, login, vault, dan service lokal harus tersedia di mesin remote tersebut. Folder pertama workspace digunakan sebagai batas akses file.

## Metode koneksi

| Provider                 | Dukungan                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex                    | CLI resmi di PATH atau executable path; sesi lokal; `codex login --device-auth`.                                                                                                                                                                              |
| Claude Code              | CLI resmi di PATH atau executable path; sesi lokal; `claude auth login`. Gunakan versi CLI terkini yang mendukung `auth status` dan permission flags.                                                                                                         |
| OpenAI                   | API key, model discovery, chat completions, function tools.                                                                                                                                                                                                   |
| Anthropic                | API key, model discovery, Messages API, tool use.                                                                                                                                                                                                             |
| Gemini                   | API key, model discovery, generateContent, function calling.                                                                                                                                                                                                  |
| OpenAI-compatible        | Custom API base, termasuk gateway dan server lokal seperti Ollama dengan endpoint `/v1`. Key opsional sesuai service.                                                                                                                                         |
| Antigravity / custom CLI | Executable dan argumen JSON dengan placeholder `{prompt}`. Harus mempunyai command non-interaktif yang benar-benar didukung. Autentikasi mengikuti mekanisme resmi service; extension tidak membaca file token atau mengasumsikan dukungan login Antigravity. |

Koneksi API dapat memiliki credential terpisah dan dipakai beberapa agent. Koneksi CLI menggunakan sesi aktif milik CLI; dua label koneksi ke CLI yang sama **tidak** membuat dua akun terisolasi. Langganan aplikasi konsumen tidak otomatis menyediakan akses API. Extension tidak menginstal CLI atau menjalankan login tanpa tindakan pengguna.

Codex memakai sandbox `read-only` atau `workspace-write`. Claude dibatasi ke Read/Glob/Grep dan, jika diizinkan, Edit/Write. Eksekusi CLI dengan izin edit memerlukan persetujuan sebelum dijalankan. Custom CLI mengatur permission-nya sendiri; gunakan hanya executable yang dipercaya. Managed connectors digunakan oleh agent API; CLI dapat memakai konfigurasi tool native-nya sendiri.

## Connector dan akses file

Tambahkan MCP **stdio** (executable + argumen JSON), MCP **Streamable HTTP**, atau service **HTTP GET read-only**. Uji koneksi, lalu assign ke agent API. Agent menerima daftar tool MCP dan dapat memanggilnya selama percakapan atau task; setiap pemanggilan tool MCP dan service memerlukan persetujuan IDE. Transport SSE lama yang memakai endpoint `/sse` terpisah tidak didukung.

Credential HTTP dikirim sebagai Bearer token. Credential stdio diinjeksi hanya ke variabel yang ditentukan, misalnya `SERVICE_API_KEY`. Jangan memasukkan secret ke argumen atau URL. API endpoint harus HTTPS, kecuali HTTP untuk localhost. TLS verification tetap aktif dan redirect ditolak agar credential tidak diteruskan ke host lain.

Agent API dapat membaca file workspace melalui tool yang dibatasi ke root proyek. Aktifkan **Allow workspace edits** untuk menyediakan tool penulisan file; setiap penulisan memerlukan konfirmasi. Tidak ada tool shell otomatis untuk agent API. Maksimum 12 putaran tool per tahap, 2 MB respons, 50 KB pembacaan file, dan 100 KB penulisan file. Proses CLI dibatasi 10 menit. Workspace restricted mode memblokir eksekusi agent dan connector.

## Knowledge & Skills

Pilih vault Obsidian, centang hanya note yang ingin dikirim, lalu **Save context**. Subfolder Markdown didukung, direktori tersembunyi dan symlink tidak dipindai. Daftar dibatasi 500 note dengan kedalaman 8 folder; tiap note maksimum 50 KB dan total konteks maksimum 100.000 karakter.

Buat skill melalui form atau import Markdown, lalu assign ke agent. Import membuat salinan; perubahan file asli tidak otomatis disinkronkan. Instruksi skill dan note terpilih dicatat sebagai sumber pada task. Skill berupa instruksi teks; referensi file tambahan dalam skill tidak otomatis dimuat.

Task dapat diekspor ke `ADR/<task-id>.md`, manual atau otomatis. Ekspor mencatat status sebenarnya dan hasil tiap tahap, tanpa mengarang status audit lulus atau keputusan Accepted. Mengirim ulang task yang sama memperbarui file ekspornya.

## Chat dan Tasks

Chat memiliki riwayat per agent dan workspace. **Create task from message** memindahkan draft ke form task. Susun sampai enam tahap; role bebas ditentukan, misalnya Planner → Implementer → Reviewer. Satu eksekusi aktif pada satu waktu agar perubahan workspace tidak bertabrakan.

- `Running`: tahap sedang berjalan.
- `Needs input`: menunggu persetujuan pengguna.
- `Needs review`: semua tahap mengembalikan hasil; pengguna perlu menilai hasil dan temuan audit.
- `Completed`: percakapan selesai, atau hasil task sudah diterima melalui **Accept result**.
- `Failed`: tahap gagal; tahap berikutnya dilewati.
- `Cancelled`: eksekusi dibatalkan.
- `Interrupted`: extension berhenti saat eksekusi; tidak dilanjutkan diam-diam.

Buka detail task untuk melihat hasil tiap tahap, sumber konteks, tool calls, dan error. **Retry as new run** mengulang alur sebagai record baru. **Run revision** menjalankan kembali tahapan dengan hasil sebelumnya dan instruksi revisi; tidak ada loop revisi otomatis. Review dan pengujian yang disebut agent tetap perlu dibuktikan melalui hasilnya. Respons agent tidak dianggap sebagai bukti audit lulus.

Konfigurasi dan riwayat disimpan di `globalStorageUri/mesh.json`; credential berada di IDE SecretStorage. Riwayat dapat berisi kode atau output proyek, jadi ikuti kebijakan penyimpanan proyek. Secret tidak disimpan dalam konfigurasi atau dikirim ke webview. Workspace asal dicatat pada task; retry/revisi harus dilakukan dari workspace tersebut.

## Pengembangan dan validasi

Gunakan Node.js **22+** untuk development tooling. Runtime extension tidak memerlukan paket npm eksternal.

```sh
npm ci
npm run check
npm test
npm run test:ui
npm run package
```

Untuk UI test, install Chromium atau set `CHROMIUM_PATH` ke browser Chromium Anda. Default Linux: `/usr/bin/chromium`. Test menjalankan Chromium asli, backend extension message handler, dan provider fixture lokal; tidak memakai key atau akun eksternal. Screenshot disimpan di `artifacts/`.

Tekan **F5** pada repository ini untuk menjalankan konfigurasi Extension Development Host. `test/host.cjs` juga dapat dijalankan oleh VS Code melalui `--extensionDevelopmentPath=<repo> --extensionTestsPath=<repo>/test/host.cjs` untuk memeriksa aktivasi dan command.

## MCP server standalone

```sh
node src/mcp/mcpServer.js --data-dir /path/to/a2a-data
```

Server memakai JSON-RPC newline-delimited melalui stdio, bukan HTTP. `--data-dir` dapat menunjuk direktori global storage extension untuk memakai konfigurasi yang sama, tetapi jangan menjalankan kedua proses terhadap file yang sama secara bersamaan. Tanpa argumen, direktori default adalah `~/.local/share/a2a-mesh`.

Tools: `a2a_list_agents`, `a2a_consult_agent`, `a2a_run_council` (dengan daftar ID agent), dan `a2a_sync_obsidian_adr` (dengan task ID). Tidak ada akun atau agent simulasi bawaan. Credential standalone dibaca dari environment `A2A_CONNECTION_<ID>` / `A2A_CONNECTOR_<ID>`: ubah karakter selain huruf/angka pada ID menjadi underscore, lalu uppercase. Credential IDE tidak diekstrak. Tool yang membutuhkan persetujuan pengguna ditolak pada mode standalone. Jangan menaruh secret dalam command line atau file konfigurasi.

## Batas validasi

Runtime diuji dengan provider dan MCP fixture lokal, termasuk kegagalan, pembatalan, penulisan file, persistensi, dan alur multi-agent. UI diuji di Chromium dan aktivasi diuji dalam VS Code asli. Login dan inference terhadap akun provider sungguhan memerlukan akun serta izin provider Anda; fixture test bukan bukti akses akun tersebut. Dukungan CLI custom dan kompatibilitas Antigravity perlu dicocokkan dengan versi service yang digunakan.
