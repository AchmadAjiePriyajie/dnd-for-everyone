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

## Menjalankan combat

1. Dari room campaign, DM membuka **Encounter**, menyusun party dan monster,
   lalu menyimpan template encounter.
2. Buka **Combat**, pilih template dan peta pertarungan jika diperlukan, lalu
   tekan **Siapkan combat**.
3. Buka **Sesuaikan** pada setiap makhluk untuk mengatur initiative dan urutan
   seri. Angka urutan seri yang lebih kecil mendapat giliran lebih dahulu.
4. Jika memakai peta, pilih **Token peta** dan tekan **Hubungkan token** pada
   panel makhluk yang sesuai. Token dapat dibuat melalui halaman peta terlebih
   dahulu; token baru juga dapat dihubungkan selama combat berlangsung.
5. Tekan **Mulai combat**. Gunakan **Giliran berikutnya**, **Jeda combat**,
   **Lanjutkan combat**, dan **Akhiri combat** sesuai jalannya permainan.

Pelacak mencatat Aksi, Aksi Bonus, Reaksi, dan sisa gerakan. Gerak token yang
terhubung memakai budget yang sama. Reaksi dapat dipakai di luar giliran sendiri;
budget dipulihkan saat makhluk tersebut memulai giliran berikutnya. Slot spell dan
resource fitur tidak direset oleh pergantian giliran.

DM dapat menambahkan bantuan, menyembunyikan combatant, atau mengoreksi HP dan
budget dengan alasan yang tercatat. HP karakter mengikuti sheet; HP monster
disimpan pada instance combat tanpa mengubah template. Untuk token yang HP-nya
sudah terhubung, ubah HP melalui sheet atau pelacak combat.

### Dadu dan HP

Di halaman **Combat**, gunakan **Baki dadu** untuk ekspresi seperti `2d6+3`,
ability check, attack roll, saving throw, atau initiative. Masukkan modifier
manual dan DC/AC jika diperlukan. Advantage dan Disadvantage saling meniadakan.
Untuk mengisi initiative combat secara otomatis, pilih makhluk pada **Lempar
sebagai** saat fase persiapan.

Semua dadu dilempar server. Ekspresi dibatasi 100 karakter, 100 dadu aktual,
dan 1000 sisi per dadu. Damage kritis menggandakan dadu, bukan modifier.
Pilih penerima **Publik** atau **DM dan pelempar**; lemparan makhluk tersembunyi
harus privat. Jika jawaban jaringan hilang, **Ulangi lemparan yang sama** memakai
request yang sama sehingga hasil tidak dilempar ulang.

Jika respons perubahan HP atau command combat terputus, gunakan **Ulangi perintah
yang sama**. Aplikasi menyimpan envelope semula agar damage tidak diterapkan dua kali.

Lemparan tidak memakai slot atau budget aksi dan tidak menerapkan damage.
DM menerapkan hasil melalui **Kelola HP dan kondisi** pada makhluk yang dituju.
Resistance, Immunity, dan Vulnerability monster mengikuti data stat block.
Override pertahanan mengganti seluruh profil; isian kosong berarti tidak ada
pertahanan tersebut. Gunakan profil ini untuk pertahanan karakter atau efek
sementara yang belum memiliki data terstruktur.

HP sementara diserap lebih dahulu dan tidak ditumpuk. Karakter pada HP 0
melakukan death save pada gilirannya; tiga kegagalan berarti mati, tiga sukses
berarti stabil, dan hasil 20 memulihkan 1 HP. Monster mati pada HP 0 secara
default; DM dapat mengaktifkan death saves untuk monster tertentu. HP dan
kondisi tersimpan bersama data campaign. Pending resolution dan reaksi yang
menunggu keputusan dilanjutkan pada task berikutnya.

### Aksi terpandu

Saat combat berjalan, panel **Aksi terpandu** menampilkan serangan senjata,
spell yang disiapkan, fitur class, dan aksi stat block monster milik makhluk
yang kamu kendalikan. Pilih aksi, target yang terlihat, level spell slot, dan
mode damage (lempar atau rata-rata untuk monster). Pratinjau diperiksa server
tanpa memakai biaya; **Lakukan aksi ini** memakai Action/Bonus Action/Reaction,
spell slot, Concentration, pemakaian fitur, Recharge, pemakaian per hari, atau
Legendary Action dalam satu command.

Label otomasi menunjukkan batasnya: **Otomatis** (biaya, lemparan, dan usulan
perubahan HP dari data terstruktur), **Dibantu** (sebagian efek perlu DM), atau
**Manual** (teks aturan + keputusan DM). Spell buff/utility seperti Bless tidak
dianggap damage. Multiattack membuka jatah serangan sesuai stat block;
Recharge dilempar server pada awal giliran monster. Player tidak melihat
AC atau modifier save monster.

### Resolusi terbuka

Setiap aksi yang dilakukan menjadi resolusi yang tersimpan. Biaya dipakai saat
aksi dikonfirmasi dan tidak dipakai lagi saat resolusi diselesaikan. Bila target
memiliki reaksi yang sesuai (misalnya Shield), pemiliknya dapat memilih
**Pakai …** atau **Tolak** di panel **Resolusi terbuka**. DM lalu memeriksa
usulan perubahan HP, boleh mengubah angkanya, dan menekan **Terapkan**; HP
berubah tepat sekali walaupun jaringan putus dan perintah diulang.

**Batalkan aksi** tidak mengembalikan biaya. Pengembalian biaya adalah koreksi
DM yang wajib diberi alasan. Perubahan HP yang sudah diterapkan dapat dikoreksi
dengan **Batalkan perubahan Hit Points**; riwayat tetap tersimpan. Resolusi
tetap ada setelah reload atau restart host. Saat perangkat offline, tombol
combat dinonaktifkan sampai tersambung dan tersinkron kembali.

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
| `npm run test:e2e` | Menjalankan test browser Playwright terhadap hasil build (jalankan `npm run build` dan `npx playwright install chromium` lebih dulu) |
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
