# Peninjauan referensi D&D 2024 untuk desain platform

Tanggal: 2026-10-30  
Folder sumber: `docs/2024 (5.5e)`  
Tujuan: menggunakan koleksi yang diberikan pengguna untuk memperbaiki desain platform D&D, dengan dukungan EN dan ID.

## Cakupan peninjauan

Terinventarisasi 54 file: 49 PDF, empat peta PNG, dan satu DOCX. Hasil ekstraksi PDF mencakup 4.190 halaman, termasuk halaman kosong/sampul. Semua PDF dapat diproses; 48 memiliki teks, satu berupa scan yang diperiksa melalui render visual. Ini adalah peninjauan struktur dan bagian yang relevan untuk desain, bukan klaim seluruh halaman telah dibaca mendalam atau seluruh materi telah dikonversi menjadi data aplikasi.

Inventory lengkap dengan path relatif, ukuran, jumlah halaman hasil ekstraksi, dan tingkat peninjauan ada di [2024-library-inventory.json](2024-library-inventory.json). Source file tidak diubah. Ekstraksi/render ditempatkan sementara di `tmp/pdfs/reference-review` dan dibersihkan setelah peninjauan; bukan deliverable atau konten yang akan disajikan aplikasi.

## Sumber utama dan implikasi desain

Nomor halaman di bawah adalah nomor fisik PDF, dihitung mulai dari 1, kecuali disebutkan berbeda. Beberapa PDF scan mempunyai offset terhadap nomor cetak.

| Sumber relatif terhadap folder referensi | Bagian yang ditinjau | Implikasi untuk aplikasi |
|---|---|---|
| `Core Rules/Player_s Handbook (2024).pdf` | Struktur buku dan pengantar; pembuatan karakter PDF 35–36 (nomor cetak 36–37), diperiksa secara visual; lokasi progression/multiclass dan glossary diindeks | Karakter menyatukan class, background, species, language, equipment, fitur dan progression. UI perlu menjelaskan asal fitur serta perubahan angka. Bahasa UI berbeda dari language yang dikuasai karakter. |
| `Core Rules/Dungeon Master_s Guide (2024).pdf` | Struktur; encounter PDF 118–119, tabel budget pada PDF 119 diperiksa visual; lokasi session zero dan bastions diindeks | Encounter mencakup social/exploration/combat. Difficulty memakai budget revisi 2024, dengan konteks risiko, bukan hasil pasti. Session zero dan hubungan party mendukung onboarding. |
| `Core Rules/Monster Manual (2024).pdf` | Pembuka/stat block PDF 8, 11–12; format Action, Bonus Action, Reaction, Legendary Action dan penggunaan terbatas | Data monster membutuhkan tipe aksi dan recovery per fitur. Damage rata-rata dan formula dadu adalah pilihan alternatif. Stat block unik tetap dapat dijalankan DM secara manual. |
| `Core Rules/D&D Basic Rules (2024).pdf.pdf` | Daftar isi, cakupan kelas/origin/equipment/rules/monster, bagian awal | Struktur navigasi reference reader dan tautan antarentri. Akses gratis ke dokumen tidak diperlakukan sebagai bukti seluruh isinya sama dengan corpus SRD. |
| Tiga PDF dalam `Advice&Errata` | Seluruh teks update PHB, DMG, dan MM | Versi sumber dan snapshot errata harus tercatat. Perubahan bisa menyentuh target save, penggunaan spell, movement, kondisi, recovery dan angka; data hasil OCR tidak boleh diimpor tanpa pengecekan. |
| `Campaigns&Adventures/Starter Sets/Heroes of the Borderlands/Heroes of the Borderlands.pdf` | Struktur, onboarding dan tutorial pada PDF 6–7; lokasi awal adventure diindeks | Onboarding per role, hubungan karakter, tutorial kontekstual dan rujukan aturan saat dibutuhkan. Scene tidak harus mengikuti cerita linear. |
| `Campaigns&Adventures/Starter Sets/Welcome to the Hellfire club/Welcome to the Hellfire Club.pdf` | Struktur, persiapan dan panduan DM/player pada PDF 8–9 | Penulisan scene memisahkan persiapan, read-aloud, rujukan stat block, trigger dan outcome. Hubungan cerita/handout/encounter perlu mudah dibuka saat bermain. |
| `Campaigns&Adventures/Oneshots/Borderlands Quest Goblin Trouble.pdf` | Pembuka, persiapan dan panduan presentasi | DM pemula terbantu checklist persiapan dan rujukan monster yang diperlukan. Tutorial orisinal dapat memakai pola belajar sambil bermain tanpa menyalin cerita. |
| `Campaigns&Adventures/Oneshots/Fated Flight of the Recluse.pdf` | Semua 12 halaman diperiksa visual; file scan tanpa teks terindeks | Scene dapat melibatkan skill checks, perubahan sikap NPC, environment, perjalanan, chase, dan keputusan selain menang combat. Manual resolution diperlukan untuk skenario khusus; sistem tidak boleh memaksa seluruh encounter menjadi attack/damage. |
| Premade characters dalam starter set | Header/fitur sampel; Fighter level 1 diperiksa visual | Sheet menempatkan statistik inti, attack, mastery, inspiration, traits, equipment dan penggunaan fitur dalam satu karakter. Template premade hanya referensi alur; custom character tetap utama. |
| `D&D Encounters/Season of Horror` | Pengantar adventure serta sampel karakter | Mendukung sesi bersambung, recap dan referensi fitur tambahan. Opsi supplement dipisahkan dari corpus SRD. |
| Empat PNG dalam `Handouts/Maps` | Seluruh gambar diperiksa visual | Peta beragam ukuran/rasio/skala; grid harus dapat dikalibrasi, pan/zoom, ukuran token dan alternatif tap perlu tersedia. Pisahkan peta DM dari informasi yang boleh diterima player. |

## Sumber tambahan

Struktur dan pembuka/daftar isi adventure lain ditinjau untuk mengenali hubungan hook, lokasi, NPC, encounter, reward dan level karakter: Dragon Delves, Hold Back the Dead, Scions of Elemental Evil, The Tenebrous Stone, dan Uni and the Hunt for the Lost Horn. Handout starter set ditinjau sebagai contoh dokumen yang dibagikan selektif, bukan dijadikan isi bawaan project.

Daftar isi/pembuka supplement Forge of the Artificer, Forgotten Realms Heroes of Faerûn, Astarion’s Book of Hungers, Lorwyn First Light, Forgotten Realms Adventures in Faerûn dan Netheril’s Fall ditinjau untuk mengenali kategori tambahan: class/subclass, species/background/feat, equipment/spell, setting/lore, faction, environmental effect dan adventure. Ravenloft The Horrors Within memiliki teks OCR tidak rapi; struktur/bagian pengantar diperiksa secara terbatas dan tidak digunakan sebagai sumber angka aturan.

Materi tambahan tersebut membantu membentuk schema konten dan editor homebrew yang dapat berkembang. Kehadiran file tidak otomatis menambahkan semua supplement, setting, bastion atau mekanik kendaraan sebagai fitur rilis pertama; cakupan produk tetap mengikuti desain yang disetujui.

DOCX `Missing Books (2024).docx` telah dibaca melalui isi OOXML. Isinya berupa catatan penambahan/ucapan terima kasih, bukan manifest lengkap buku yang hilang; tidak dipakai untuk mengklaim kelengkapan koleksi.

## Temuan kualitas sumber

- Enam premade PDF memiliki path terlalu panjang untuk extractor. Ekstraksi berhasil dengan salinan sementara bernama pendek; source tetap utuh.
- Fated Flight berupa scan; pencarian teks biasa tidak dapat menemukan isinya. Pembacaan visual sudah dilakukan, tidak diklaim sebagai teks OCR tervalidasi.
- Core scan dan beberapa premade memiliki salah baca karakter/kolom atau teks bertumpuk. Untuk data yang akan dijadikan rumus/statistik, pemeriksaan halaman sumber dan cross-check SRD diperlukan.
- Hasil ekstraksi header file Season of Horror bernama Lividity menampilkan Zora, sedangkan file bernama Zora menampilkan Lividity. Ini catatan pemeriksaan sumber yang perlu dikonfirmasi visual sebelum mengimpor identitas; jangan menjadikan nama file sebagai ID karakter.
- Nama folder/file tahun 2024 tidak cukup untuk menetapkan tahun penerbitan atau snapshot errata; provenance harus mengikuti isi dan sumber versi sebenarnya.

## Perubahan desain yang diterapkan

1. Dua bahasa EN/ID menjadi requirement eksplisit; pemilihan per peserta dan dapat berubah saat bermain tanpa mengubah state.
2. Seluruh UI/bantuan dan corpus SRD dirancang mempunyai varian EN/ID. Terjemahan ID ditandai sebagai terjemahan aplikasi; teks sumber EN tetap tersedia. Tidak memerlukan API penerjemah saat LAN.
3. Stable content IDs, rules, event, error codes dan angka terpisah dari teks terlokalisasi; search menerima istilah kedua bahasa.
4. Wizard memperjelas background/origin feat, species traits, language, armor training; sheet/aksi mencakup Weapon Mastery dan Heroic Inspiration.
5. Monster abilities memiliki action type dan recovery masing-masing; encounter non-combat dan resolusi DM tetap dapat dicatat.
6. Source corpus dan errata diberi versi; koleksi referensi tidak otomatis disajikan sebagai static files, dibundel publik, atau dimasukkan backup campaign.
7. Acceptance menambahkan party EN/ID pada room yang sama, pergantian locale tanpa kehilangan input, ketepatan terjemahan angka/efek, aksesibilitas dan kelengkapan kedua locale.

Desain utama: [2026-10-30-dnd-platform-design.md](../superpowers/specs/2026-10-30-dnd-platform-design.md).
