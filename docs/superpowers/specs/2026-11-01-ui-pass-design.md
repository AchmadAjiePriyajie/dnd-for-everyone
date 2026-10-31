# UI pass — design

Tanggal: 2026-11-01. Status: menunggu persetujuan pengguna. Berlaku sebelum Task 20 (tutorial) dan Task 22 (audit), di atas spec utama `2026-10-30-dnd-platform-design.md` (spec utama tetap otoritas untuk aturan, akses, dan data).

## 1. Intent

DM biasanya bermain **sendirian di PC** dan harus membuka banyak tab sekaligus: map, rules, initiative/turn, dadu, HP. Fitur Task 1–19 dibuat dengan UI fungsional per task, sehingga alat yang dipakai bersamaan tersebar di halaman berbeda dan banyak halaman harus di-scroll panjang.

Pass UI ini menata ulang tampilan supaya:

- saat combat, semua yang dibutuhkan DM terlihat di **satu layar**, tertata per bagian, tidak terasa sesak;
- player di laptop, tablet, dan HP punya layar yang nyaman, termasuk melihat status timnya;
- halaman lain tidak lagi membutuhkan scroll sangat panjang;
- aplikasi punya satu identitas: nama, ikon bernuansa fantasy, dan gaya yang konsisten.

Ini bukan penambahan fitur aturan. Perilaku server tetap, kecuali dua perubahan proyeksi di §4.3 dan §4.4.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Layar combat terpadu untuk DM (map + urutan turn + status + aksi + resolusi + dadu + rules) tanpa pindah halaman.
2. Layar player dengan pola yang sama di laptop dan tab bawah di HP.
3. Status tim terlihat oleh sesama party; monster/NPC lawan hanya ditandai secara kasar.
4. Halaman panjang dipecah per bagian dan daftar panjang memakai pagination.
5. Nama produk **Campfire Tales**, ikon fantasy, dan gaya komponen yang seragam.

**Non-goals**
- Mengubah aturan, otomasi, atau model data di luar §4.3/§4.4.
- Tema baru: tema perkamen yang ada dipertahankan.
- Ikon unik untuk setiap spell atau aksi monster.
- Fitur baru di luar yang disebut di sini (chat, audio, dan sebagainya).

**Anti-goals** (gagal walaupun "berfungsi")
- Layar combat yang terasa penuh sesak atau memaksa DM menebak di mana sesuatu berada.
- Bocornya info rahasia lewat UI baru: angka HP/AC/save monster, makhluk tersembunyi, atau resource pribadi player lain.
- Memakai aset, ikon, logo, atau nama dari Baldur's Gate 3 atau merek Wizards of the Coast. Yang diambil hanya cara menampilkan aksi dan resource, dengan visual orisinal.
- Tombol yang mengubah state secara lokal sebelum server mengonfirmasi, atau tetap aktif saat offline.

## 3. Constraints

- Stack tetap: React/Vite + react-i18next, gaya di `apps/web/src/app/styles.css` (token warna yang ada).
- Semua aset (ikon, font) disajikan dari host sendiri; tidak ada CDN, agar sesi LAN berjalan tanpa internet (spec utama).
- EN/ID untuk semua teks baru; `npm run locales:audit` tetap lulus. Teks ID yang lebih panjang tidak boleh terpotong atau merusak layout.
- Aksesibilitas tetap: kontrol keyboard, label aksesibilitas, fokus terlihat. Map tetap SVG dengan kontrol DOM seperti Task 13.
- Proyeksi server tetap satu-satunya penentu apa yang dilihat member. UI tidak menyaring rahasia di client.
- Test yang ada (Vitest + Playwright) tetap lulus. Test UI yang memeriksa layout lama diperbarui, bukan dihapus.
- Atribusi lisensi ikon (CC BY 3.0) dan konten SRD (CC BY 4.0) tersedia di dalam aplikasi.

## 4. Keputusan pengguna

### 4.1 Layar combat DM (opsi A)

Satu halaman, dengan tiga kolom dan hotbar:

- **Kiri, urutan turn.** Satu baris ringkas per makhluk: initiative, nama, bar HP, chip status effect/kondisi, dan resource penting (Aksi/Bonus/Reaksi, slot, Legendary, Recharge). Baris giliran aktif disorot.
- **Tengah, map.** Token dan posisinya, dengan penanda giliran aktif.
- **Bawah map, hotbar aksi ala BG3** (opsi A dari mockup kedua). Resource giliran tampil sebagai simbol yang menyala atau padam: ● Aksi, ▲ Bonus, ◆ Reaksi, bar gerak, dan bulatan slot. Aksi tampil sebagai ubin yang dikelompokkan per biaya. Ubin yang tidak bisa dipakai redup. Arahkan kursor atau fokus untuk ringkasan: biaya, dadu, dan label otomasi. Hotbar menampilkan makhluk yang sedang giliran; DM dapat berpindah ke makhluk lain, misalnya untuk reaksi atau Legendary Action.
- **Kanan, panel bertab:** Resolusi, Dadu, Rules. Rules bisa dicari dan dibaca tanpa meninggalkan layar.

Disetujui pengguna (playback): kontrol koreksi DM (initiative, HP manual, sembunyikan, token binding) masuk ke menu per baris, tidak selalu terbuka. Halaman Combat dan Scene digabung menjadi layar ini. Halaman persiapan (encounter, catatan, homebrew) tetap terpisah.

### 4.2 Layar player

- **Laptop:** pola yang sama dengan layar DM. Urutan turn di kiri, map di tengah, hotbar aksi miliknya di bawah. Di kanan ada kartu karakter sendiri (HP, AC, resource giliran, slot, Concentration) dan tab Dadu, Rules, Journal.
- **HP:** tab di bawah layar (Map, Karakter, Aksi, Turn, Lainnya), satu bagian memenuhi layar.
- **Pemberitahuan:** tawaran reaksi dan hasil yang perlu perhatian muncul menonjol di atas tab apa pun.
- Makhluk tersembunyi tidak muncul. Nama monster mengikuti proyeksi yang ada.

### 4.3 Status tim (perubahan proyeksi server)

Sesama anggota party saling melihat HP, Temporary HP, kondisi, Concentration, dan status death save karakter lain. Slot, inventory, catatan, dan data pribadi lain tetap hanya untuk pemilik dan DM. Saat ini proyeksi combat menyembunyikan HP karakter lain dari player, jadi proyeksi itu diubah.

### 4.4 Monster/NPC lawan (perubahan proyeksi server)

Player hanya melihat tanda kasar, tanpa angka: **Bloodied** (istilah SRD 2024, HP setengah maksimum atau kurang) dan **tumbang/defeated**. Kondisi yang terlihat di meja (Prone, Grappled, dan lain-lain) pada monster yang terlihat ditampilkan ke player. AC, modifier save, angka HP, dan makhluk tersembunyi tetap rahasia.

### 4.5 Halaman lain

- Halaman yang isinya banyak dipecah menjadi bagian dengan tab atau langkah, supaya tidak perlu scroll panjang.
- Daftar panjang memakai pagination, dengan pencarian dan filter tetap tersedia.
- Wizard pembuatan karakter tetap bertahap, dengan tiap langkah lebih ringkas.

### 4.6 Identitas

- Nama produk: **Campfire Tales**, di judul tab, header, teks UI (EN/ID), README, dan dokumen yang menyebut nama produk. Dipilih karena tanpa unsur merek "D&D/DND". Ketersediaan nama untuk publik belum dicek.
- Tema perkamen terang yang ada dipertahankan, termasuk mode gelap otomatis.
- Ikon: koleksi **game-icons.net** (SVG, CC BY 3.0), disimpan di host, dengan atribusi. Dipasang **per jenis**: school sihir, tipe damage, kategori senjata, serta ikon umum untuk heal, buff, gerak, reaksi, fitur, dan aksi monster. Tidak ada ikon unik per spell.

## 5. Diserahkan ke builder (keputusan saya, boleh dikoreksi)

1. **Breakpoint:** lebar ≥1200 px memakai tiga kolom + hotbar. Lebar 768–1199 px (tablet/laptop kecil) memakai map + hotbar dengan urutan turn dan panel kanan sebagai laci yang bisa dibuka. Lebar <768 px memakai tab bawah. Dugaan: tablet lebar memakai layout laptop.
2. **Memilih target:** klik token di map atau baris di urutan turn. Pilihan via checkbox tetap tersedia untuk aksesibilitas dan tanpa map.
3. **Resolusi menunggu:** tab Resolusi menampilkan jumlah dan otomatis menonjol bila ada tawaran reaksi atau keputusan DM.
4. **Rules di panel:** memakai komponen reference reader yang ada, dalam mode ringkas (cari + baca + tautan ke halaman penuh).
5. **Dadu:** tab Dadu berisi DiceTray yang ada. History roll memakai pagination.
6. **Room campaign:** dibagi menjadi bagian Party, Sesi, Persiapan DM, dan Undangan, dengan navigasi berkelompok dan penanda status (sesi berjalan, combat aktif, giliranmu).
7. **Sheet karakter:** dibagi menjadi tab Ringkasan, Aksi & Spell, Inventory, Fitur, dan Level up.
8. **Ukuran halaman pagination:** 20 item per halaman untuk monster, spell/reference hasil cari, catatan, homebrew, roll history, dan log sesi. Pagination di client bila data sudah di snapshot; pagination server tidak ditambah kecuali daftar dari API memang besar.
9. **Font:** Cinzel dan Crimson Pro (SIL OFL) di-bundle sebagai file lokal. Saat ini font itu hanya tampil bila sudah terpasang di perangkat.
10. **Ikon mana yang dipilih** dari game-icons.net: dipilih builder per kategori; daftar pemetaan disimpan di satu modul supaya mudah diganti.
11. **Route:** `/campaigns/:id/combat` menjadi layar terpadu; `/campaigns/:id/scenes` tetap untuk mengelola scene (upload, grid, fog) di luar combat, dan map di layar combat memakai komponen BattleMap yang sama.
12. **Token di map:** aturan §4.3/§4.4 juga berlaku untuk HP token di map; player melihat bar HP token party dan tanda Bloodied/defeated pada token monster yang terlihat.
13. **Bentuk data Bloodied:** proyeksi player untuk monster mengirim `condition: 'healthy' | 'bloodied' | 'defeated'` tanpa angka; dihitung di server dari HP instance.
14. **Urutan pengerjaan:** (1) identitas + ikon + font, (2) proyeksi status tim/monster, (3) layar combat DM, (4) layar player + mobile, (5) halaman lain + pagination, (6) EN/ID overflow check.

## 6. Cara memeriksa hasil

- Mockup referensi: `.superpowers/brainstorm/1795-1793465456/content/` (`dm-layout.html` opsi A, `player-layout.html` cara 1, `action-bar.html` opsi A).
- Test server: player melihat HP/kondisi/Concentration/death save karakter lain, tetapi tidak slot/inventory; monster hanya `bloodied`/`defeated` + kondisi; makhluk tersembunyi tidak ada.
- Test UI: layar combat DM menampilkan urutan turn, map, hotbar, dan panel kanan sekaligus; hotbar meredupkan aksi yang tidak bisa dipakai; tab bawah di lebar HP; pagination pada daftar panjang; EN/ID tanpa teks terpotong pada lebar 360 px dan 1280 px.
- E2E Playwright yang ada tetap lulus, disesuaikan dengan layout baru.
