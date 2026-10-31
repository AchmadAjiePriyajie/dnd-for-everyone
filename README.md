# DND for Everyone

Platform untuk mengelola permainan Dungeons & Dragons dengan campaign, karakter,
referensi aturan, encounter, catatan, dan battle map. Aplikasi memakai React + Vite
untuk frontend, NestJS + Fastify untuk server, Socket.IO untuk pembaruan realtime,
dan SQLite untuk penyimpanan data.

## Kebutuhan

- Node.js **minimal 24.15.0**, sesuai `package.json`, beserta npm.
- Git untuk mengambil project dari repository.
- Browser untuk membuka aplikasi.
- Koneksi internet saat clone dan install dependency.

Periksa instalasi melalui terminal:

```sh
node --version
npm --version
git --version
```

SQLite memakai modul bawaan Node.js sehingga tidak perlu memasang server database
terpisah. Perintah berikut dijalankan dari root project.

## Setup di device lain

Ambil branch `tahap-1` yang digunakan untuk project ini:

```sh
git clone --branch tahap-1 https://github.com/AchmadAjiePriyajie/dnd-for-everyone.git
cd dnd-for-everyone
npm ci
npm run build
npm start
```

Jika repository meminta autentikasi, gunakan akun GitHub yang memiliki akses.

Buka **http://localhost:3000**. Pada instalasi dengan data baru, ikuti form untuk
membuat akun host pertama. Database dan tabel dibuat otomatis saat server mulai.

Biarkan terminal tetap berjalan selama aplikasi digunakan. Tekan `Ctrl+C` untuk
menghentikan server. Untuk menjalankan kembali tanpa perubahan kode, cukup:

```sh
cd dnd-for-everyone
npm start
```

Jalankan `npm run build` kembali setelah mengubah kode atau memperbarui project.

## Akses dari device lain dalam jaringan yang sama

Hanya komputer host yang perlu memasang project. Device pemain cukup memakai browser
dan terhubung ke jaringan yang sama.

Setelah build, jalankan server agar menerima koneksi dari jaringan.

Windows PowerShell:

```powershell
$env:HOST = "0.0.0.0"
npm start
```

macOS atau Linux:

```sh
HOST=0.0.0.0 npm start
```

Cari alamat IP lokal komputer host. Di Windows, jalankan `ipconfig` pada terminal
lain dan lihat IPv4 Address pada adapter jaringan yang sedang dipakai.

Contoh: jika IP host `192.168.1.10`, pemain membuka
**http://192.168.1.10:3000**. Gunakan IP komputer host pada browser pemain;
`localhost` mengarah ke device pemain sendiri.

Izinkan Node.js atau koneksi masuk TCP port `3000` pada firewall jaringan privat.
Komputer host dan proses server harus tetap menyala selama bermain.

## Memindahkan data ke device baru

Secara default, data disimpan di folder `data/` pada root project:

| Lokasi | Isi |
| --- | --- |
| `data/dnd.sqlite` | Database akun, campaign, karakter, dan data permainan |
| `data/assets/` | File asset yang diunggah, termasuk map |
| `data/backups/` | Backup database sebelum migrasi database yang sudah berisi versi skema lama |

Folder `data/` tidak ikut Git. Clone repository menghasilkan instalasi baru tanpa
akun atau campaign dari device lama.

Untuk membawa data lama:

1. Hentikan server di device lama dan device baru dengan `Ctrl+C`.
2. Simpan salinan folder data tujuan jika device baru sudah memiliki data.
3. Salin **seluruh folder `data/`** dari device lama ke root project di device baru.
4. Jalankan `npm start` di device baru, lalu masuk dengan akun lama.

Gunakan versi kode yang sama saat pemindahan. Menyalin seluruh folder saat server
berhenti juga membawa file pendamping SQLite jika masih ada serta asset permainan.
Jika memakai `DATA_DIR`, salin direktori yang ditunjuk variabel tersebut.

## Development

Install dependency dengan `npm ci`, lalu gunakan dua terminal dari root project.

Terminal pertama, jalankan backend:

```sh
npm run dev
```

Terminal kedua, jalankan frontend:

```sh
npm run dev:web
```

Buka **http://localhost:5173**. Vite meneruskan request `/api` dan `/socket.io`
ke backend di `http://127.0.0.1:3000`.

Frontend diperbarui melalui Vite saat kode diubah. Backend dibuild saat
`npm run dev` dijalankan; hentikan lalu jalankan ulang perintah tersebut setelah
mengubah kode backend.

## Konfigurasi

Konfigurasi dibaca dari environment variable proses. File `.env` tidak dimuat
otomatis oleh entry point server.

| Variabel | Default | Kegunaan |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Alamat bind server; gunakan `0.0.0.0` untuk akses jaringan |
| `PORT` | `3000` | Port HTTP dan Socket.IO |
| `DATA_DIR` | `data` | Direktori database, asset, dan backup; path relatif dihitung dari direktori kerja |
| `WEB_DIR` | `dist/web` | Direktori hasil build frontend yang disajikan server |
| `DND_HOST_URL` | `http://127.0.0.1:3000` | Target proxy backend untuk Vite saat development |

Contoh mengganti port pada PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

Buka `http://localhost:3001`. Jika memakai Vite saat development, atur juga
`DND_HOST_URL` pada terminal frontend ke alamat backend yang baru.

## Perintah project

| Perintah | Fungsi |
| --- | --- |
| `npm ci` | Install dependency sesuai `package-lock.json` |
| `npm run build` | Build backend dan frontend ke `dist/` |
| `npm start` | Menjalankan backend dan menyajikan frontend hasil build |
| `npm run dev` | Build dan menjalankan backend untuk development |
| `npm run dev:web` | Menjalankan frontend melalui Vite |
| `npm run typecheck` | Memeriksa tipe TypeScript backend dan frontend |
| `npm test` | Menjalankan test Vitest |
| `npm run locales:audit` | Memeriksa data terjemahan |
| `npm run content:audit` | Memeriksa corpus konten |

## Mengatasi kendala umum

- **`npm.ps1 cannot be loaded` pada PowerShell:** gunakan `npm.cmd`, misalnya
  `npm.cmd ci`, `npm.cmd run build`, dan `npm.cmd start`.
- **Modul `node:sqlite` tidak tersedia atau versi Node tidak sesuai:** periksa
  `node --version` dan gunakan Node.js minimal `24.15.0`.
- **Halaman utama 404 atau hasil build tidak ditemukan:** jalankan
  `npm run build` dari root project, lalu jalankan ulang `npm start`.
- **Port sedang dipakai (`EADDRINUSE`):** hentikan proses yang menggunakan port
  tersebut atau ubah `PORT`.
- **Device pemain tidak bisa terhubung:** periksa `HOST=0.0.0.0`, alamat IP host,
  port, firewall, dan koneksi jaringan kedua device.
- **Akun atau campaign lama tidak muncul:** pastikan folder data lama sudah
  dipindahkan dan server memakai `DATA_DIR` yang benar.
