# Panduan terjemahan ID corpus SRD 5.2.1

Terjemahan Bahasa Indonesia adalah terjemahan aplikasi (tidak resmi). Teks EN
tetap tersedia sebagai `originalName`/fallback. Kebijakan dipilih pengguna
pada 2026-10-30: **campuran** — istilah aturan tetap bahasa Inggris, narasi
dan penjelasan berbahasa Indonesia.

## Yang tetap bahasa Inggris (huruf besar seperti sumber)

- **Kata kunci aturan**: Advantage, Disadvantage, Hit Points (HP), Temporary
  Hit Points, Hit Point Dice, Armor Class (AC), Proficiency Bonus, D20 Test,
  ability check, saving throw, attack roll, Difficulty Class (DC), critical hit,
  Heroic Inspiration, Initiative, Speed (Burrow/Climb/Fly/Swim Speed),
  Concentration, Ritual, cantrip, spell slot, spell attack, spellcasting
  ability, Short Rest, Long Rest, Bloodied, Exhaustion level, Resistance,
  Vulnerability, Immunity, Cover (Half/Three-Quarters/Total Cover),
  Difficult Terrain, Bright Light, Dim Light, Darkness, Lightly/Heavily
  Obscured, Emanation, Sphere, Cone, Cube, Cylinder, Line.
- **Action**: Action, Bonus Action, Reaction, dan nama action (Attack, Dash,
  Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study,
  Utilize). Contoh: "mengambil Magic action", "sebagai Bonus Action".
- **Condition**: Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled,
  Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained,
  Stunned, Unconscious. Contoh: "memiliki condition Frightened".
- **Ability dan skill**: Strength, Dexterity, Constitution, Intelligence,
  Wisdom, Charisma; Athletics, Perception, dst. Contoh: "check Wisdom
  (Perception)", "saving throw Constitution".
- **Tipe damage**: Acid, Bludgeoning, Cold, Fire, Force, Lightning, Necrotic,
  Piercing, Poison, Psychic, Radiant, Slashing, Thunder. Pola: "8d6 damage
  Fire" (kata *damage* tetap).
- **Ukuran dan tipe makhluk**: Tiny, Small, Medium, Large, Huge, Gargantuan;
  Aberration, Beast, Humanoid, Undead, dst.
- **Nama diri**: nama spell (miring, mis. *Fireball*), magic item, monster,
  class, subclass, species, background, feat, senjata/armor/gear, plane.
- Singkatan dan label stat block: AC, HP, DC, PB, CR, XP, GM, ft., lb., GP,
  SP, CP, EP, PP.

## Yang diterjemahkan

- Narasi, penjelasan aturan, contoh, judul bagian bab (mis. "Rhythm of Play" →
  "Ritme Permainan"). Judul entri glossary yang merupakan kata kunci (mis.
  "Hit Points") tetap Inggris.
- Satuan: feet → kaki, foot → kaki, mile(s) → mil, pound(s) → pon, hour →
  jam, minute → menit, round → ronde, day → hari. Singkatan "ft."/"lb." tetap.
- Label field: Casting Time → Waktu Casting, Range → Jangkauan, Components →
  Komponen, Duration → Durasi, Self → Diri sendiri, Touch → Sentuhan,
  Instantaneous → Seketika, "Concentration, up to 1 minute" → "Concentration,
  hingga 1 menit", "Using a Higher-Level Spell Slot" → "Menggunakan Spell Slot
  Level Lebih Tinggi", "Cantrip Upgrade" → "Peningkatan Cantrip".
- Nama kolom tabel diterjemahkan; isi sel mengikuti aturan di atas.

## Aturan teknis (diperiksa audit)

- Semua angka, dadu dan jarak identik dengan EN (urutan boleh berubah); jangan
  mengubah, menambah atau menghapus angka. Kata bilangan dalam teks EN ("two")
  boleh ditulis sebagai kata ("dua").
- Struktur markdown dipertahankan: paragraf, `***Run-in.***`, daftar, tabel
  (jumlah kolom sama), blockquote sidebar, tautan `ref:`.
- `sourceHash` dihitung otomatis dari teks EN oleh
  `scripts/content/merge_translation.py`; jangan ditulis tangan.
- Gunakan "kamu" untuk "you" (sapaan pemain), konsisten dengan UI.

## Stat block monster (dipilih pengguna 2026-10-30)

- Summary (ukuran, tipe, alignment), semua baris label (`**AC**`, `**Skills**`,
  `**Senses**`, `**Languages**`, `**CR**`, dst.), tabel ability, judul bagian
  (`#### Actions`, `#### Bonus Actions`, `#### Reactions`, …) dan nama
  trait/action tetap persis seperti EN.
- Baris serangan tetap EN sampai klausa `*Hit:* … damage`; sisa kalimat efek
  (mis. "plus …", saving throw, condition) dan semua narasi trait/action
  diterjemahkan.
