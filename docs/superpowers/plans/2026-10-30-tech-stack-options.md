# Pilihan tech stack platform D&D 2024

Tanggal: 2026-10-30  
Status: Pengguna memperjelas pilihan menjadi React frontend + NestJS backend. Alternatif sebelumnya dipertahankan sebagai catatan perbandingan.  
Desain: [D&D platform design](../specs/2026-10-30-dnd-platform-design.md).

## Kriteria penilaian

Platform harus dapat dijalankan sebagai host LAN Windows tanpa internet setelah instalasi, diakses browser HP/laptop, dan dipasang online dengan kode produk yang sama. Dibutuhkan realtime multiplayer, persistence, aturan D&D 2024, EN/ID, character builder, cerita/encounter DM, peta 2D dan backup. Target penerimaan awal satu DM dengan delapan player per room, bukan layanan dengan ribuan room yang sudah teruji.

Penilaian kelebihan/kekurangan berikut adalah pertimbangan engineering untuk kebutuhan tersebut, bukan hasil benchmark terhadap implementasi yang belum dibuat.

## A. React dan NestJS dengan TypeScript — pilihan pengguna

Komponen: React + Vite + TypeScript; NestJS dengan Fastify sebagai HTTP adapter; Socket.IO melalui Nest WebSocket Gateway; SQLite pada host; i18next/react-i18next; react-konva; MiniSearch; Vitest dan Playwright. Pengguna memperjelas nama framework **NestJS**; Next.js tidak digunakan.

Kelebihan:

- Satu bahasa utama untuk client, server, kontrak, validator, dan perhitungan aturan. Tipe dan fungsi murni tertentu dapat dipakai bersama tanpa menulis ulang di bahasa berbeda; server tetap otoritas hasil.
- HTTP API, file frontend hasil build dan realtime dapat ditangani satu proses Node. DM tidak perlu menjalankan database service terpisah pada LAN.
- React/TypeScript dan react-konva menyediakan fondasi UI interaktif dan peta 2D; i18next mengelola kedua bahasa; pencarian lokal tidak membutuhkan AI/API internet.
- Node v24.21.0 sudah tersedia di workspace. Pemeriksaan in-memory `node:sqlite` berhasil; ini bukti kompatibilitas dasar runtime, bukan verifikasi aplikasi.
- NestJS memberi struktur module/controller/provider dan guard, sehingga batas fitur campaign, karakter, encounter dan combat dapat diatur eksplisit. Gateway dapat berbagi port dengan HTTP; production host tetap satu proses.

Kekurangan:

- NestJS menambah konfigurasi module, dependency injection dan decorator dibanding Fastify langsung. Test/build harus mempertahankan metadata yang dibutuhkan; struktur tambahan perlu dijaga agar tidak menjadi boilerplate berlebihan.
- Guard dan validation primitives tetap membutuhkan kebijakan akses game yang benar; akun, kepemilikan karakter, rahasia DM, backup dan alur editor masih harus diimplementasikan serta diuji.
- Realtime membutuhkan desain transaksi, idempotency dan resync; library socket tidak otomatis mencegah slot spell atau damage diterapkan dua kali.
- Peta sentuh, keyboard dan pembaca layar memerlukan desain khusus. Canvas saja tidak menyediakan seluruh aksesibilitas.
- Pengelolaan dependency frontend dan ukuran bundle perlu disiplin. Perhitungan berat atau impor corpus tidak boleh memblokir event loop selama sesi.

Pilihan persistence rekomendasi: SQLite melalui `node:sqlite`, SQL migration bernomor dan repository per fitur. Gunakan subset API yang dibuktikan pada runtime target; jangan mengasumsikan semua API dokumentasi Node terbaru tersedia pada Node 24. Tidak perlu ORM pada awal project. Patch dependency yang kompatibel dipilih/dikunci dalam lockfile saat implementasi.

## B. Vue dan Laravel dengan Reverb

Komponen: Vue 3 + TypeScript + Vite; Laravel/PHP; Laravel Reverb + Echo; SQLite; Vue i18n; Konva; PHPUnit/Pest dan Playwright.

Kelebihan:

- Laravel menyediakan komponen autentikasi, authorization, validation, migrations, storage dan testing; cocok untuk banyak formulir campaign, NPC, quest dan inventory.
- Reverb menyediakan WebSocket yang dihost sendiri, sehingga realtime tidak bergantung layanan cloud dan dapat dipakai di LAN.
- Cocok jika pengelola project ingin bekerja dalam ekosistem PHP/Laravel. PHP/Laragon sudah terdeteksi pada mesin ini.

Kekurangan:

- Rules dan kontrak backend PHP terpisah dari TypeScript frontend. Gunakan schema/API contract atau code generation bila diperlukan; tidak ada pembagian tipe otomatis hanya karena memakai TypeScript pada Vue.
- Host mengoperasikan HTTP app dan proses Reverb; worker tambahan dibutuhkan jika memakai queued broadcasting/jobs. Packaging dan start LAN lebih banyak bagiannya daripada satu proses aplikasi.
- Framework tetap tidak menyediakan engine D&D, token/map atau state combat secara otomatis; bagian permainan khusus harus dibuat.

## C. React dan ASP.NET Core dengan SignalR

Komponen: React + Vite + TypeScript; ASP.NET Core/C#; SignalR; EF Core + SQLite; react-i18next; react-konva; xUnit dan Playwright.

Kelebihan:

- Model C# cocok untuk aturan/domain yang terstruktur dan backend terpusat. SignalR mendukung komunikasi realtime ke client tertentu atau group/room.
- HTTP, frontend statis dan hub realtime dapat berjalan pada satu host ASP.NET Core tanpa layanan realtime cloud.
- Publikasi self-contained dapat menyertakan runtime .NET, sehingga DM dapat menjalankan hasil distribusi tanpa memasang .NET terpisah. Paket tetap spesifik OS/arsitektur.
- Cocok jika project akan dikelola pengembang C#/.NET atau distribusi host lokal yang dikompilasi menjadi prioritas.

Kekurangan:

- Backend C# dan frontend TypeScript membutuhkan kontrak yang dijaga bersama atau digenerasikan; logika bersama tidak langsung dapat diimpor seperti opsi A.
- Toolchain dan build terdiri dari .NET serta Node untuk frontend. Pada pemeriksaan workspace, `dotnet` tersedia tetapi `dotnet --list-sdks` tidak menampilkan SDK.
- Distribusi self-contained lebih besar dan perlu build untuk tiap target. Ia tidak menghapus kebutuhan testing runtime, backup, otorisasi atau reconnect.

## Database dan deployment berlaku untuk ketiga opsi

SQLite adalah rekomendasi awal untuk host satu proses dengan transaksi pendek. Browser berbicara ke server aplikasi; tidak membuka file database langsung melalui network share. SQLite hanya memiliki satu writer pada satu waktu; kemampuan memenuhi target harus dibuktikan lewat load test.

PostgreSQL lebih tepat ketika kebutuhan beralih ke banyak server aplikasi atau intensitas penulisan bersamaan yang tidak memadai dengan antrean transaksi pendek. Peralihan memerlukan migrasi nyata dan pengujian; bukan mengganti satu connection string saja.

Server LAN dan online menjalankan produk yang sama. Database dan asset disimpan pada disk persisten host. Online membutuhkan host yang mendukung proses berjalan terus, koneksi realtime dan HTTPS. Cloud-only backend/serverless-only hosting tidak menjadi dependensi inti karena tidak memenuhi kebutuhan host LAN tanpa internet.

## Keputusan dan langkah berikutnya

Pengguna memperjelas frontend React dan backend NestJS. Ini menetapkan opsi A dengan NestJS, menggantikan Fastify langsung sebagai framework aplikasi. Fastify dipakai sebagai adapter HTTP internal Nest; bukan backend kedua. Rincian adapter, SQLite dan library UI tetap merupakan keputusan teknis pembuat sesuai kebutuhan LAN/online.

[Rencana implementasi React/NestJS](2026-10-30-dnd-platform-implementation.md) sudah diperbarui dengan module/controller/provider, gateway, lifecycle database, upload adapter dan test tooling. Langkah berikutnya adalah review rencana dan pilihan metode eksekusi Native/subagent-driven sesuai Superpowers, sebelum kode aplikasi dibuat.

## Sumber primer yang diperiksa

- [React dengan TypeScript](https://react.dev/learn/typescript), [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/), [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/).
- [NestJS HTTP adapters](https://docs.nestjs.com/techniques/performance), [WebSocket gateways](https://docs.nestjs.com/websockets/gateways), [static SPA](https://docs.nestjs.com/recipes/serve-static), [file upload](https://docs.nestjs.com/techniques/file-upload), [testing](https://docs.nestjs.com/fundamentals/testing) dan [Vitest/SWC](https://docs.nestjs.com/recipes/swc#vitest).
- [Socket.IO introduction](https://socket.io/docs/v4/) dan [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).
- [Node SQLite API](https://nodejs.org/api/sqlite.html) dan [kapan SQLite sesuai](https://www.sqlite.org/whentouse.html).
- [Laravel Reverb](https://laravel.com/docs/13.x/reverb), [release requirements](https://laravel.com/docs/13.x/releases).
- [ASP.NET Core SignalR](https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction?view=aspnetcore-10.0) dan [.NET publishing](https://learn.microsoft.com/en-us/dotnet/core/deploying/).
- [react-konva](https://konvajs.org/docs/react/index.html), [react-i18next](https://react.i18next.com/), [MiniSearch](https://lucaong.github.io/minisearch/).
