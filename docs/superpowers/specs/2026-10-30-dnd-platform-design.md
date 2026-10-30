# Desain platform D&D revisi 2024

Tanggal: 2026-10-30  
Status: React frontend dan NestJS backend ditetapkan pengguna; rencana disesuaikan dan menunggu review serta metode eksekusi.  
Workspace: `C:\Kerja\DND`, kosong saat eksplorasi awal; kini berisi koleksi referensi `docs/2024 (5.5e)`. Belum menjadi repository Git.

## 1. Intent dan keputusan pengguna

Platform web untuk bermain D&D dari persiapan campaign sampai sesi berikutnya. DM dan setiap player menggunakan perangkat masing-masing. Pengalaman memandu pemula, tetapi tetap dapat digunakan setelah mereka menguasai permainan.

Keputusan pengguna: sisi DM dan player interaktif; bermain online maupun LAN; player membuat karakter; DM menulis cerita, membuat encounter dan menghitung difficulty; menyimpan session; membaca aturan; cakupan bermain lengkap; aturan revisi 2024; aplikasi web dengan server yang dapat dijalankan di laptop DM atau internet.

Tambahan instruksi pengguna: baca folder referensi yang ditambahkan ke workspace dan gunakan dua bahasa, English (EN) serta Bahasa Indonesia (ID). Detail pemilihan bahasa dan kontrak terjemahan pada bagian 4.1 merupakan usulan implementasi pembuat.

Keputusan teknologi berikutnya: frontend **React** terpisah dan backend **NestJS**. Pengguna mengoreksi penyebutan Next menjadi Nest; Next.js tidak digunakan. Vite, Fastify sebagai adapter internal Nest, SQLite dan library pendukung adalah rincian implementasi yang dipilih pembuat.

## 2. Goals, non-goals, dan anti-goals

Goals:

- Seluruh alur bermain tersedia: campaign, karakter, persiapan DM, eksplorasi/roleplay, combat, perkembangan karakter, save dan resume.
- Informasi rahasia DM dan kepemilikan karakter dijaga server.
- Bantuan kontekstual memungkinkan pemula bermain tanpa menghafal aturan.
- LAN dapat berjalan tanpa internet setelah instalasi paket awal selesai.
- Data tetap tersedia setelah browser/server ditutup; reconnect tidak menggandakan aksi.
- Konten bawaan mencakup materi permainan SRD 5.2.1, dengan atribusi dan asal data.
- Antarmuka, bantuan pemula, dan referensi SRD mendukung EN/ID; peserta satu room dapat menggunakan bahasa berbeda.

Non-goals rilis lengkap pertama, sebagai usulan pembuat: AI pengganti DM, voice/video call, marketplace/langganan, integrasi akun D&D Beyond, impor otomatis buku komersial, desktop/native mobile, ruleset 2014, dunia 3D, pencahayaan dinamis berbasis tembok, mesin penafsir otomatis semua spell/homebrew, dan sinkronisasi edit paralel dua host. Seluruh modul pada bagian 5 tetap termasuk cakupan penyelesaian project.

Anti-goals: tombol inti tidak berfungsi; mengklaim konten lengkap padahal hanya sampel; membebani pemula dengan semua angka sekaligus; mengirim rahasia ke browser player lalu menyembunyikannya dengan CSS; menyimpan satu-satunya campaign di localStorage; mencampur rumus difficulty 2014 dengan revisi 2024.

## 3. Pendekatan yang dipertimbangkan

### Bentuk produk

1. Pendamping sesi terpandu tanpa meja virtual: cocok untuk belajar, tetapi tidak memenuhi klarifikasi pengguna tentang bermain sepenuhnya di perangkat masing-masing.
2. Platform lengkap dengan karakter, campaign, encounter, meja virtual dan referensi: dipilih berdasarkan klarifikasi pengguna.

### Cara distribusi

1. **Web untuk DM/player, server lokal atau internet: dipilih pengguna.** Player cukup membuka browser. Memerlukan panduan sederhana menjalankan host LAN.
2. Desktop host khusus DM, player tetap web: server lokal dapat dikemas lebih praktis, tetapi menambah installer, pembaruan dan matriks OS. Ditunda.

## 4. Ruleset, konten, dan bahasa

- Campaign menyimpan ruleset `srd-5.2.1-2024`; pembaruan aplikasi tidak mengubah aturan campaign secara diam-diam.
- Target corpus bawaan adalah seluruh materi permainan SRD 5.2.1: aturan, opsi karakter, progression level 1–20, spell, equipment, magic item, monster, dan panduan encounter yang tercakup sumber tersebut.
- Pilihan/subclass di luar SRD tidak boleh diklaim tersedia sebagai konten bawaan. Homebrew memungkinkan DM menambah opsi miliknya.
- Entri menyimpan ID stabil, jenis, versi, sumber bagian/halaman, dan lisensi. Terdapat manifest cakupan; paket sampel tidak memenuhi rilis lengkap.
- Bahasa produk: EN dan ID, sesuai permintaan pengguna. Teks sumber Inggris tetap tersedia; terjemahan ID dan ringkasan bantuan diidentifikasi secara jelas.
- Aturan, asset bawaan, font dan icon disajikan dari host sendiri; tidak membutuhkan CDN/API eksternal selama sesi LAN.
- Paket konten versioned, dengan migrasi eksplisit dan kemampuan membaca campaign lama.

### 4.1 Kontrak EN/ID

- Pilihan EN/ID tersedia sebelum login dan selama bermain. Preferensi per pengguna tersimpan; pemilihan awal mengikuti browser untuk `en`/`id`, selain itu fallback EN. Mengganti bahasa tidak mereset wizard, input draft, posisi peta, karakter, atau combat.
- Cakupan terjemahan UI: onboarding DM/player, wizard dan sheet, editor campaign, encounter/difficulty, meja virtual, combat, journal, reference reader, homebrew, pengaturan, validasi, notifikasi, state error/loading/kosong, aksesibilitas, dan bantuan pemula.
- Konten SRD yang ditampilkan memiliki varian EN dan ID dengan ID entri yang sama. Varian ID adalah terjemahan aplikasi yang ditinjau, bukan terjemahan resmi Wizards. Atribusi, sumber dan keterangan perubahan/terjemahan dipertahankan.
- Nama/istilah asli tetap dapat dilihat dan dicari ketika ID aktif, misalnya Action/Aksi, Bonus Action/Aksi Bonus, Movement/Pergerakan. Nama karakter, NPC dan lokasi serta tulisan DM/player tidak diterjemahkan otomatis.
- Semua terjemahan inti dibundel dan bekerja di LAN tanpa API penerjemah. Fallback EN ditandai untuk entri tambahan/homebrew yang tidak memiliki ID; kekurangan terjemahan corpus inti tetap merupakan pekerjaan yang belum selesai, bukan alasan mengklaim rilis bilingual lengkap.
- State, rules, stable content IDs, perintah dan event server bersifat netral bahasa. Error memakai kode dan parameter; client menerjemahkan. Log menyimpan data terstruktur sehingga DM EN dan player ID membaca kejadian yang sama tanpa perubahan hasil roll atau resource.
- Bahasa UI terpisah dari languages karakter seperti Common/Elvish. Pergantian EN/ID tidak mengubah unit/jarak atau aturan campaign. Pencarian mendukung istilah/alias kedua bahasa dan format angka mengikuti locale hanya pada tampilan.

### 4.2 Pemakaian referensi lokal dan errata

- Koleksi pengguna terinventarisasi pada [catatan referensi](../../references/2024-library-review.md) dan [inventory](../../references/2024-library-inventory.json). Ditinjau untuk memahami alur, struktur data, kebutuhan pemula dan pemeriksaan silang revisi 2024; ini bukan pernyataan seluruh halaman telah dibaca mendalam.
- Pisahkan ruleset, versi corpus SRD dan snapshot errata sumber. Perubahan dari PHB/DMG/MM atau supplement lokal ditinjau terhadap entri yang relevan sebelum dimasukkan; jangan mengubah baseline campaign secara otomatis hanya karena file referensi lebih baru.
- Prioritaskan kebenaran rules sumber dan errata yang sesuai, bukan nama file. Core PDF memiliki hasil OCR yang perlu pemeriksaan visual untuk angka/tabel; karakter premade dipakai sebagai contoh alur, bukan disalin menjadi satu-satunya model karakter.
- Reference folder tetap bahan kerja lokal, bukan direktori static aplikasi, konten publik, atau isi backup otomatis. Corpus bawaan tetap SRD; supplement/adventure menginformasikan desain tanpa otomatis menjadi seluruh konten bawaan rilis.
- Struktur penulisan scene membedakan persiapan DM, read-aloud text, rujukan stat block, trigger, kemungkinan hasil dan reward. Jangan mengunci encounter sebagai combat saja; social/exploration dapat memakai checks, DC, timers, kondisi dan keputusan DM.

## 5. Modul produk

### 5.1 Akun, campaign, dan room

- Akun username/password per instalasi server; tidak perlu email atau login vendor. First-run membuat pemilik server; pengguna terautentikasi dapat membuat campaign dan menjadi DM campaign itu.
- Satu DM pemilik per campaign pada rilis awal. Satu akun dapat memiliki peran berbeda pada campaign lain.
- DM membuat kode/link undangan player yang dapat dicabut/diganti. Undangan tidak dapat menaikkan role menjadi DM. Registrasi melalui undangan atau bootstrap pemilik; tidak ada listing campaign publik.
- Keanggotaan dan ownership karakter bertahan setelah logout/restart. DM dapat mengeluarkan anggota dan mentransfer karakter secara eksplisit.
- Usulan kapasitas penerimaan awal: satu DM dan sampai delapan player aktif per room; satu server dapat menyimpan beberapa campaign.

### 5.2 Karakter dan progression

- Wizard dengan draft tersimpan: konsep, motivasi, hubungan party, species, background, class, ability scores, proficiency, equipment, spell, dan review akhir.
- Standard array, point buy, atau roll tercatat; DM memilih metode yang diizinkan. Pilihan/prerequisite memakai revisi 2024 dan menampilkan asal fitur.
- Wizard menjelaskan kontribusi background terhadap ability scores/Origin Feat, species traits, languages karakter dan armor training. Pilihan yang dihasilkan tetap terbatas pada konten campaign yang tersedia/disetujui.
- Sheet menghitung ability modifiers, proficiency bonus, saves/skills, AC dari equipment, HP, initiative, speed, attack bonus, dan spell DC.
- Kelola inventory, currency, attunement, limited-use features, known/prepared spells sesuai class, slots, concentration, conditions, dan rests.
- Heroic Inspiration dan pilihan Weapon Mastery tersedia eksplisit pada sheet/aksi; jumlah penggunaan dan recovery fitur mengikuti sumber, bukan reset semua resource secara seragam.
- Level up 1–20, subclass/feat/ability improvement yang tersedia di SRD, dan multiclass sesuai sumber; review draft sebelum diterapkan. Semua opsi SRD dapat dicatat dan digunakan, termasuk fitur yang memerlukan adjudikasi DM.
- Player mengedit karakter miliknya; DM dapat memperbaiki dan memberi override pada nilai turunan dengan penanda tanpa merusak nilai dasar.
- DM menetapkan milestone atau XP. Rest/level up yang memengaruhi sesi aktif dikendalikan sesuai pengaturan DM dan dicatat di log.

### 5.3 Campaign, cerita, dan persiapan DM

- Ringkasan dunia, bab/scene, hook, NPC, lokasi, quest, encounter, handout, catatan dan journal sesi, dengan tautan antarentri.
- Editor teks/Markdown aman dengan autosave, status pending/saved/error, dan preview; HTML/script dari penulis atau impor tidak dijalankan.
- Visibility DM, party, atau anggota tertentu. Materi persiapan default rahasia; DM membagikan informasi saat bermain. Cerita dapat bercabang tanpa urutan scene wajib.
- Cheat sheet party: AC, HP, Passive Perception, conditions dan resource relevan. HP dipisahkan dari statistik pasif.
- Generator nama NPC lokal dan catatan keputusan aturan untuk diperiksa setelah sesi.
- Sertakan adventure tutorial orisinal: hook mendesak, roleplay, skill check dan combat mudah. Tidak memakai adventure komersial.

### 5.4 Encounter dan difficulty

- Cari/filter monster SRD; buat/duplikasi monster homebrew dengan stat block dan XP jelas. Pilih party aktif, level masing-masing, jumlah musuh, variasi HP, target difficulty dan posisi awal.
- Budget XP Low/Moderate/High mengikuti tabel revisi 2024. Party berbeda level: jumlahkan budget masing-masing karakter, dengan penanda estimasi sebagai keputusan pembuat.
- XP monster dijumlahkan tanpa multiplier jumlah musuh 2014. Tampilkan target budget, total, sisa/kelebihan, dan risiko terrain/jumlah lawan/CR tinggi.
- Untuk estimasi label susunan: di bawah Low; Low sampai sebelum Moderate; Moderate sampai sebelum High; High sampai budget High; melampaui High. Target difficulty pilihan DM tetap terlihat.
- Party kosong, level di luar 1–20, atau monster tanpa XP tervalidasi memerlukan koreksi input; tidak menghasilkan difficulty palsu.
- Difficulty adalah panduan. Template encounter terpisah dari instance combat agar HP saat bermain tidak mengubah persiapan.

### 5.5 Meja virtual, scene, dan eksplorasi

- Grid kosong atau peta PNG/JPEG/WebP upload lokal; atur ukuran grid/skala, token karakter/monster/NPC/objek, pan/zoom, drag atau tap-to-move, pengukuran jarak, ping dan penanda area efek.
- Player mengelola token miliknya; DM mengelola seluruh scene. HP/status token terkait dengan entitas yang sama di sheet/combat.
- Hidden token, catatan rahasia dan asset DM-only tidak dikirim ke player. Gambar latar yang dibagikan harus aman dilihat peserta; jangan menyembunyikan gambar penuh berisi rahasia dengan overlay CSS lalu menganggapnya aman.
- Fog/reveal manual oleh DM; tidak ada line-of-sight/pencahayaan dinamis. Di luar area terungkap, token/teks rahasia tetap diredaksi server. DM memakai asset/handout terpisah untuk materi yang sungguh rahasia.
- Movement memakai skala grid, speed/budget, dan difficult terrain yang ditetapkan. Default diagonal didokumentasikan dan dapat diubah; DM dapat override posisi/jarak.
- Roleplay dapat berlangsung tanpa grid aktif, dengan chat/log, handout, quest dan journal.

### 5.6 Combat dan batas otomasi

- DM memulai/mengakhiri combat, mengatur initiative/tie-break, next turn/round, reinforcement dan combatant tersembunyi.
- Track Action, Bonus Action, Reaction, movement, concentration, durasi, death saves, HP/temp HP, serta resource class/spell.
- Server menghitung d20 check/save/attack, advantage/disadvantage, damage/healing, initiative dan ekspresi dadu terbatas; rincian modifier dan audience tercatat.
- Kemampuan monster memiliki Action/Bonus Action/Reaction/Legendary Action, Multiattack, Recharge dan batas penggunaan masing-masing sesuai stat block. DM dapat memilih damage rata-rata atau roll ketika sumber menyediakan keduanya. Penerapan manual tetap tersedia untuk efek unik.
- Serangan/spell terpandu menampilkan target yang diketahui player, jarak, attack/save, damage/healing, dan resource. Perhitungan umum, critical dice dan pemakaian slot/HP diotomasi sesuai data terstruktur.
- Tidak mengasumsikan semua spell adalah damage. Fitur kompleks menyediakan teks aturan, roll, resource tracker, keputusan DM dan penerapan hasil manual tercatat. Tampilkan apakah efek sudah otomatis atau perlu DM; jangan mengklaim seluruh efek telah disimulasikan.
- Pisahkan roll percobaan dari commit pemakaian resource/penerapan hasil. Request idempotent mencegah retry memakai slot atau damage dua kali.
- Reaksi/hasil belum selesai disimpan sebagai pending resolution. Penyelesaian/pembatalan dan pemakaian/pengembalian resource tercatat.
- DM override/koreksi menghasilkan event kompensasi dan alasan; tidak menghapus riwayat diam-diam.

### 5.7 Referensi dan homebrew

- Pencarian/filter lokal, bookmark, dan tautan kontekstual untuk aturan, opsi karakter, spell, monster dan item, dengan versi/atribusi.
- Editor homebrew monster, item, spell serta opsi/fitur karakter; validasi, label homebrew, dan persetujuan DM per campaign.
- Homebrew berupa data/formula aman dalam format didukung; tidak mengeksekusi JavaScript atau kode upload.

### 5.8 Session, autosave, resume dan backup

- Campaign menyimpan data jangka panjang; session mencatat pertemuan, waktu, recap, journal, log dan encounter terkait.
- Perubahan penting disimpan sebelum ack berhasil. Editor memakai debounce/autosave dengan indikator belum/sudah tersimpan dan kegagalan.
- Pause/resume memulihkan scene, token, giliran, HP/resource dan pending resolution terakhir yang committed. Reconnect mengambil snapshot terbaru sesuai role tanpa membuat akun/karakter baru atau mengulang aksi.
- Ekspor campaign lengkap milik DM: schema/ruleset version, data, log relevan, homebrew dan asset. Tidak memuat password, cookie atau undangan aktif.
- Impor memvalidasi schema, ukuran, path dan relasi; preview; lalu membuat salinan campaign baru secara atomik, tanpa menimpa campaign lain secara default.
- Pengimpor menjadi DM; anggota lama menjadi placeholder untuk diundang dan ditautkan ulang. Ownership karakter dipulihkan melalui penetapan DM. Undangan lama tidak berlaku.
- Satu host aktif menjadi sumber kebenaran. Pindah LAN/online melalui ekspor/impor; tidak ada merge edit dua host otomatis.
- Backup database memakai mekanisme konsisten beserta asset, bukan menyalin SQLite secara sembarang saat ada transaksi.

## 6. Keputusan teknologi dan rincian arsitektur

React frontend dan NestJS backend ditetapkan pengguna. Rincian library/versi lainnya dipilih pembuat berdasarkan kompatibilitas tanpa mengubah perilaku produk atau mengganti framework yang telah dipilih.

- TypeScript; client React/Vite dengan komponen responsif dan peta SVG/canvas 2D; hasil build disajikan aplikasi server yang sama.
- Catalog terjemahan UI memakai key stabil EN/ID; konten game menyimpan teks terlokalisasi terpisah dari angka/formula. Validasi build memeriksa key, interpolation parameters dan kelengkapan locale; tidak menggabungkan kalimat dari potongan terjemahan yang bergantung tata bahasa Inggris.
- Backend NestJS pada Node.js LTS yang kompatibel, dengan module/controller/provider per domain. Fastify menjadi HTTP adapter internal; Socket.IO melalui WebSocket Gateway memakai port yang sama. Guard, validation pipe dan exception filter menjadi adapter untuk kebijakan akses/domain. Database provider singleton dikelola lifecycle Nest.
- SQLite untuk satu proses host dengan foreign keys, transaksi dan migrasi bernomor; asset di direktori data. Rencana memilih API `node:sqlite` yang kompatibel dengan runtime host dan diuji sebelum dibundel.
- Modul `web`, `server`, `shared` (schema/kontrak/projection), `rules` (perhitungan murni), dan `content` (SRD/manifest). Struktur file rinci diserahkan ke builder.
- Tidak membutuhkan Redis, database cloud, login vendor atau API AI untuk alur inti; satu proses server, bukan microservices.
- Pembacaan melalui snapshot; mutasi melalui command dengan request ID, target, payload dan expected revision bila relevan. Server memeriksa autentikasi, membership, role, ownership dan fase aksi.
- Transaksi menyimpan state, revision, event dan receipt idempotency bersama. Ack/broadcast hanya setelah commit. Reconnect socket tidak dianggap menjamin pemulihan data; client mengambil snapshot ulang.
- Perubahan stale ditolak dengan penjelasan/snapshot terbaru; editor lain tidak boleh menimpa tulisan tanpa pemberitahuan.
- Server membentuk projection sesuai peserta untuk snapshot, event, pencarian, error, log, asset dan ekspor; tidak broadcast objek DM mentah.
- Entitas: account, auth session, campaign/member/invitation, character/advancement, content entry, note, scene/asset/token, encounter template, combat instance/combatant/resolution, play session, event dan command receipt.

## 7. Operasional, akses dan keandalan

- Host LAN awal Windows sesuai workspace; perintah start sederhana, alamat LAN/port yang jelas, dokumentasi jaringan sama dan firewall. Aplikasi tidak mengubah firewall otomatis.
- Setelah instalasi awal, start dan permainan tidak perlu npm install, CDN atau internet. Browser player cukup mengakses host.
- Online memakai proses server yang sama dengan persistent volume database/asset, HTTPS dan reverse proxy yang mendukung realtime. Sediakan konfigurasi dan panduan deploy; serverless-only bukan fondasi karena aplikasi harus bisa dihost sendiri di LAN.
- Akun memakai hash password standar runtime; cookie HttpOnly/SameSite dan Secure pada HTTPS; API/socket memvalidasi origin dan otorisasi yang sama.
- Pembatasan upload, validasi tipe/path, rate limit login/join/dice, log tanpa secret. Arsip/migrasi versioned, dengan backup sebelum migrasi.
- Usulan target uji LAN: 1 DM + 8 player, perubahan committed terlihat pada peserta lain sekitar 1 detik di jaringan stabil; catat perangkat/jaringan saat mengukur.
- Saat terputus, aksi combat tidak diantrekan; tampilkan status, pertahankan input draft, lalu resync sebelum aksi berikutnya.

## 8. Prinsip pengalaman pengguna

- EN/ID dengan istilah asli yang dapat ditampilkan, bantuan pemula aktif default dan dapat diringkas, serta tautan aturan kontekstual. Bahasa per pengguna tidak dipaksakan oleh bahasa DM atau campaign.
- Tindakan utama jelas; validasi ramah; review sebelum finalisasi karakter atau aksi yang memakai resource.
- DM berfokus pada persiapan/pengendalian sesi; player pada karakter, adegan, aksi dan journal.
- Pada perangkat HP, interaksi tidak bergantung pada hover/drag presisi; ada alternatif tap, panel ringkas dan dukungan keyboard. Keadaan loading/kosong/error/saved/turn/disconnected terlihat dan tidak hanya dibedakan warna.
- Usulan gaya fantasi yang tenang dan mudah dibaca; detail layout/tema diserahkan ke builder. Mockup adalah langkah opsional terpisah, belum dipilih pengguna.

## 9. Tahap pengerjaan dan syarat keluar

Tahap mengurutkan implementasi; menyelesaikan satu tahap saja belum memenuhi project.

1. **Campaign dan multiplayer:** persistence, akun/invite/role, room, migrasi, content pipeline dan snapshot realtime. Keluar jika browser berbeda bergabung dengan data sesuai role dan room pulih setelah restart.
2. **Karakter dan referensi:** wizard/sheet, corpus SRD EN/ID, equipment/spell/resource, progression/multiclass/homebrew. Keluar jika opsi SRD dapat dibuat/dikembangkan dengan perhitungan terverifikasi, kedua locale tersedia, dan referensi LAN tanpa internet.
3. **Persiapan DM:** cerita, NPC/quest/handout, encounter/difficulty dan tutorial orisinal. Keluar jika DM menyiapkan sesi dan membagikan informasi terpilih dengan akses benar.
4. **Meja virtual dan combat:** scene/map/token, jarak/movement, initiative/roll, resolusi, conditions/resource dan override. Keluar jika eksplorasi dan encounter dijalankan sampai selesai dari perangkat berbeda.
5. **Kelanjutan dan distribusi:** recap/journal, pause/resume, ekspor/impor, restart/reconnect, audit konten/akses, panduan Windows LAN dan deploy online. Keluar jika seluruh acceptance bagian 10 terpenuhi.

## 10. Verifikasi dan acceptance rilis lengkap

- Unit rules memakai contoh sumber independen: ability/proficiency/AC/HP, spellcasting/multiclass, resources/rest, damage dan difficulty; jangan sekadar menyalin implementasi ke test.
- Empat karakter level 1: budget Low 200, Moderate 300, High 400 XP. Tidak ada multiplier jumlah monster. Uji party beda level/kosong dan monster tanpa XP.
- Audit corpus terhadap manifest sumber, field wajib dan referensi silang; sampling manual lintas class/spell/monster/aturan. Daftar sampel saja tidak memenuhi cakupan penuh.
- Integrasi: role/ownership, transaksi gagal, retry idempotent, conflict, hidden data, pending resolution dan impor malformed.
- E2E minimal tiga browser context terisolasi: DM membuat campaign/cerita/encounter; dua player membuat karakter; buka scene, bergerak, roll, pakai kemampuan, selesaikan combat, beri progression dan simpan recap.
- Reconnect di tengah aksi menghasilkan state sama dan pemakaian resource/damage tepat sekali. Restart server memulihkan state committed termasuk pending resolution.
- Ekspor dan impor pada data directory bersih, undang ulang dan lanjut bermain dengan relasi/asset utuh; arsip tidak memuat credential atau undangan aktif.
- Periksa API/socket/asset/pencarian/log player langsung untuk memastikan catatan DM, hidden token dan data privat tidak terkirim.
- Viewport mobile dan desktop: wizard, giliran, rule search dan movement dapat digunakan dengan sentuhan/keyboard.
- Uji EN/ID dari onboarding hingga backup/resume, termasuk bantuan, reference reader dan error. Dua client pada room yang sama memakai EN dan ID dengan state identik; pergantian locale di tengah wizard/combat mempertahankan input/state. Pencarian alias kedua bahasa, fallback entri tambahan, parameter terjemahan, overflow teks dan label aksesibilitas diverifikasi.
- Audit terjemahan SRD mempertahankan angka, jenis action, durasi, jarak, prerequisite, resource dan makna efek. Glossary EN/ID konsisten, atribusi/penanda terjemahan tersedia; kekurangan ID corpus inti tidak dianggap selesai hanya karena fallback EN bekerja.
- Dengan internet host dimatikan setelah instalasi, room/karakter, referensi/peta, roll, autosave dan resume LAN berjalan.
- Uji 1 DM + 8 player; build/typecheck/test relevan lulus; panduan start dan batas otomasi yang membutuhkan DM tersedia.
- Verifikasi konfigurasi online dengan persistent disk/realtime. Bila akun hosting tidak tersedia, laporkan config/panduan yang telah diuji lokal dan bahwa endpoint publik belum diverifikasi; jangan mengklaim sudah live.

## 11. Keputusan yang diserahkan ke builder

- Versi dependency, HTTP framework, driver SQLite, schema database, route/command names, format formula aman, pencarian lokal dan test runner.
- Nama produk, layout/tema/icon, representasi efek dan daftar otomasi per fitur; seluruh opsi SRD harus tetap dapat digunakan melalui resolusi terpandu/manual.
- Default diagonal/grid, ukuran upload, backup dan rate limit dengan dokumentasi serta kesesuaian LAN tanpa internet.
- Rencana tugas teruji untuk setiap tahap tanpa mengurangi target akhir sepihak.

## 12. Referensi yang diperiksa

- [SRD resmi dan cakupan versi](https://www.dndbeyond.com/srd/).
- [Catatan peninjauan koleksi pengguna dan pemetaan ke fitur](../../references/2024-library-review.md), termasuk core rules, errata, contoh adventure, karakter premade dan peta.
- [SRD 5.2.1 PDF: sumber konten implementasi](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf).
- [DM’s Toolbox revisi 2024: pemeriksaan silang encounter](https://www.dndbeyond.com/sources/dnd/br-2024/dms-toolbox). Konten distribusi tetap berasal dari SRD; tidak mengasumsikan seluruh halaman D&D Beyond berlisensi SRD.
- [Socket.IO](https://socket.io/docs/v4/), [Node.js SQLite](https://nodejs.org/api/sqlite.html), [Vite](https://vite.dev/guide/). Periksa dokumentasi versi runtime sebenarnya sebelum implementasi.
- [NestJS HTTP adapters](https://docs.nestjs.com/techniques/performance), [gateways](https://docs.nestjs.com/websockets/gateways) dan [testing](https://docs.nestjs.com/fundamentals/testing).

## 13. Builder check

Pemeriksaan independen 2026-10-30 oleh subagent `design_builder_check` dengan prompt builder-check dari Superpowers brainstorming. Hasil: “nothing important left”; tidak ada pertanyaan material tambahan untuk pengguna sebelum perencanaan. Dokumen ini tetap menunggu persetujuan pengguna sebelum scaffolding atau kode aplikasi.

Revisi berikutnya: pengguna menambahkan koleksi referensi dan meminta EN/ID. Bagian 4.1/4.2 dan acceptance diperbarui. Pemeriksaan independen oleh subagent `design_revision_check` menghasilkan “nothing important left”; kontrak EN/ID, pemakaian referensi, dan batas kedalaman peninjauan cukup jelas untuk perencanaan. Pemeriksaan ini menilai dokumen, bukan mengklaim seluruh isi koleksi telah diverifikasi. Menunggu persetujuan pengguna terhadap desain revisi.

Pengguna kemudian meminta “lanjut perancangan implementasi” beserta pilihan tech stack dan pros/cons. Instruksi ini memberi arah melanjutkan desain ke tahap rencana, tanpa menganggap stack rekomendasi telah dipilih. [Rencana kandidat A](../plans/2026-10-30-dnd-platform-implementation.md) dan [pilihan stack](../plans/2026-10-30-tech-stack-options.md) tersedia untuk ditinjau. Catatan menunggu persetujuan pada paragraf sebelumnya merupakan riwayat pemeriksaan, bukan permintaan persetujuan desain ulang.

Setelah penjelasan perbedaan Next.js/NestJS, pengguna menegaskan “nest”. Stack ditetapkan menjadi React frontend dan NestJS backend; rencana diperbarui untuk Nest module/controller/provider, gateway, adapter dan test lifecycle. Review rencana dan metode eksekusi masih perlu dipilih sesuai handoff Superpowers writing-plans.

Catatan penyimpanan: dokumen tersedia sebagai file lokal. Belum dibuat commit karena workspace belum memiliki repository Git; kode aplikasi dan scaffolding belum dibuat.
