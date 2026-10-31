# D&D 2024 Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun platform web D&D revisi 2024 lengkap untuk DM/player, online dan LAN, dengan EN/ID serta campaign persisten.

**Architecture:** Satu proses server menjadi otoritas state, menyajikan frontend dan HTTP/realtime, serta menyimpan SQLite/asset pada disk host. Client hanya menerima projection sesuai hak akses; perubahan dipersistenkan sebelum dikonfirmasi dan reconnect mengambil snapshot baru. Rule engine, kontrak, locale dan corpus dipisahkan dari UI.

**Tech Stack:** React/Vite + TypeScript pada frontend; NestJS pada backend, memakai Fastify sebagai HTTP adapter; Socket.IO melalui Nest WebSocket Gateway; SQLite melalui `node:sqlite`; react-i18next, react-konva, MiniSearch, Vitest dan Playwright. SQL migrations bernomor; belum membutuhkan ORM, Redis atau layanan cloud wajib.

**Spec:** [2026-10-30-dnd-platform-design.md](../specs/2026-10-30-dnd-platform-design.md).

**Sumber stack:** [perbandingan dan dokumentasi primer](2026-10-30-tech-stack-options.md#sumber-primer-yang-diperiksa). Versi/API runtime diperiksa ulang saat membuat lockfile; isi rencana bukan bukti bahwa dependency sudah terpasang.

**Status:** Stack diperjelas pengguna menjadi React frontend dan **NestJS backend**. Rencana disesuaikan dengan NestJS dan siap ditinjau; review rencana serta pilihan metode Native/subagent-driven belum diberikan. Tidak menggunakan Next.js. [Perbandingan stack dan keputusan](2026-10-30-tech-stack-options.md) menyimpan alternatif sebelumnya.

## Global Constraints

- Ruleset campaign: `srd-5.2.1-2024`; cakupan corpus adalah seluruh materi permainan SRD 5.2.1, bukan paket sampel.
- Bahasa produk: EN dan ID, sesuai permintaan pengguna. Teks sumber Inggris tetap tersedia; terjemahan ID dan ringkasan bantuan diidentifikasi secara jelas.
- Satu DM pemilik per campaign pada rilis awal. Satu akun dapat memiliki peran berbeda pada campaign lain.
- Usulan kapasitas penerimaan awal: satu DM dan sampai delapan player aktif per room; satu server dapat menyimpan beberapa campaign.
- Setelah instalasi awal, start dan permainan tidak perlu npm install, CDN atau internet. Browser player cukup mengakses host.
- Saat terputus, aksi combat tidak diantrekan; tampilkan status, pertahankan input draft, lalu resync sebelum aksi berikutnya.
- Target penuh mencakup karakter level 1–20/multiclass, homebrew, cerita, encounter, VTT, combat, session/journal, backup, serta dokumentasi host Windows dan deploy online.
- Folder `docs/2024 (5.5e)` dan cache kerja tidak boleh masuk static build, image distribusi, index pencarian publik atau backup campaign otomatis.
- Paket dependency dikunci saat implementasi. React dan react-konva harus cocok major-nya; Node yang dipakai harus membuktikan API SQLite yang dipilih. Jangan menaikkan runtime host tanpa alasan kompatibilitas yang terverifikasi.

## Review Focus

1. Player mengirim ID karakter/note/asset campaign lain: tolak tanpa membocorkan isi atau hasil pencarian; test Task 2, 6, 11 dan 13.
2. Perintah sudah committed tetapi ack hilang, lalu dikirim ulang setelah reconnect: resource berubah sekali dan receipt lama hanya kembali untuk actor terotorisasi; test Task 3 dan 18.
3. Locale diganti ketika wizard/editor belum tersimpan atau reaksi menunggu: draft dan state identik; test Task 4 dan 18.
4. Asset besar, path traversal, arsip rusak atau versi backup lebih baru: gagal dengan aman tanpa campaign setengah terimpor; test Task 13 dan 21.
5. OCR/terjemahan mengubah angka, durasi, action type atau class progression: audit corpus dan fixtures bersumber independen, bukan menyamakan data salah dengan dirinya sendiri; test Task 5, 8, 10 dan 22.

## Struktur file dan tanggung jawab

```text
package.json, package-lock.json, tsconfig.base.json, vitest.config.ts, playwright.config.ts
apps/server/src/app.ts, app.module.ts, index.ts # bootstrap Nest, root module dan lifecycle
apps/server/src/db/                          # koneksi, migration runner, SQL bernomor
apps/server/src/features/<domain>/           # Nest module/controller dan domain service/repository
apps/server/src/commands/                    # transaksi, registration, idempotency
apps/server/src/realtime/                    # membership socket dan role projection
apps/web/src/app/                            # router, shell, API client, room store
apps/web/src/features/<domain>/              # UI per fungsi bermain
apps/web/src/locales/{en,id}/                 # catalog UI yang dibundel
packages/shared/src/                        # contracts, errors dan domain schemas
packages/rules/src/                         # fungsi murni perhitungan/validasi aturan
packages/content/{src,data,source}/           # corpus EN/ID, glossary, manifest dan provenance
tests/e2e/, tests/helpers/                  # uji lintas browser dan host restart
scripts/                                   # audit, content tooling, release tooling
deploy/, docs/guides/                       # distribusi host, backup, LAN dan online
data/                                      # runtime lokal, diabaikan Git/build
```

Gunakan folder fitur bernama `auth`, `campaigns`, `characters`, `reference`, `notes`, `encounters`, `scenes`, `combat`, `sessions`, dan `backups`. Tambahkan file sesuai tugas yang memilikinya; jangan membuat semua folder kosong terlebih dahulu. Skema database berkembang melalui migrasi bersama fitur, bukan satu tabel JSON raksasa untuk seluruh produk.

## Integrasi NestJS dan batas modul

- `createApp` membuat `NestFastifyApplication` menggunakan `NestFactory` dan `FastifyAdapter`. `AppModule` mengimpor modul yang sudah dibangun. TypeScript compiler mengaktifkan `experimentalDecorators` dan `emitDecoratorMetadata`; muat `reflect-metadata` sebelum Nest boot.
- Fitur memakai `<domain>.module.ts`, `<domain>.controller.ts`, serta provider `service.ts`. Signatures service pada task adalah metode provider yang di-inject, kecuali fungsi murni di `packages/rules`/`packages/content` dan handler berbasis `CommandContext`. Controller tipis menangani transport lalu mendelegasikan ke service; tidak memiliki salinan rumus D&D.
- `DatabaseModule` mengekspor provider singleton `DatabaseService` dengan `getHandle(): DatabaseSync`. Config memakai injection token `APP_OPTIONS`; database ditutup pada shutdown Nest, bukan membuat koneksi per request. Migrasi dan backup selesai sebelum server siap menerima koneksi.
- `AuthModule` mengekspor `AuthService`, guard dan principal resolver. Membership diperiksa ulang untuk command/snapshot; guard HTTP bukan pengganti pemeriksaan domain dalam dispatcher.
- `CommandsModule` mengekspor `CommandsService` yang memiliki `registerCommand`/`executeCommand`. Feature providers mendaftarkan handler saat module init; duplicate kind gagal saat startup, bukan menimpa handler diam-diam. Tidak ada import balik dari command infrastructure ke semua feature modules.
- `RealtimeModule` memiliki `RoomsGateway` pada port HTTP yang sama, memakai Socket.IO adapter Nest. `handleConnection` memeriksa session cookie/origin; subscribe memeriksa membership. Guard message saja tidak dianggap mengamankan handshake. Saat membership dicabut/logout, cabut subscription/session terkait dan snapshot berikutnya ditolak.
- `ContentModule` membungkus catalog framework-independent sebagai singleton provider `ContentService`; feature yang membutuhkan konten mengimpor module tersebut. Rule engine dan shared contracts tidak mengimpor Nest, React atau database.
- Global prefix HTTP adalah `/api`; path Socket.IO tetap `/socket.io`. Seluruh API error melalui exception filter menjadi `ApiError` netral bahasa. Validation pipe mendelegasikan ke shared runtime schemas, karena TypeScript interfaces saja tidak memvalidasi request.
- Saat development, Vite menjalankan UI terpisah dan mem-proxy `/api` serta `/socket.io` ke host Nest. Pada paket produksi/LAN, Nest menyajikan hasil build Vite dari direktori frontend saja, sehingga DM menjalankan satu proses dan player membuka satu alamat.
- Gunakan `ServeStaticModule`/integrasi Fastify yang sesuai versi; fallback SPA hanya untuk navigasi frontend, tidak menelan `/api/*`, `/socket.io/*`, asset privat atau API 404. File campaign dan folder referensi tidak disajikan statis.
- Upload memakai streaming multipart yang kompatibel dengan Fastify dan batas ukuran sebelum buffering. Jangan mengimpor Multer/Express interceptor ke adapter Fastify; pin implementasi terhadap dokumentasi versi Nest yang dipasang.
- Vitest backend menggunakan transform SWC yang mempertahankan legacy decorators/metadata dan setup `reflect-metadata`, sesuai recipe Nest. Pisahkan project config backend Node, frontend DOM, dan packages murni; jangan berasumsi transform default frontend cukup. Smoke test membuat dua provider yang saling di-inject dan membuktikan runtime/test build sama-sama dapat boot. Playwright tetap menjadi browser E2E runner.

Rujukan integrasi: [HTTP adapters](https://docs.nestjs.com/techniques/performance), [gateways](https://docs.nestjs.com/websockets/gateways), [static SPA](https://docs.nestjs.com/recipes/serve-static), [upload](https://docs.nestjs.com/techniques/file-upload), [testing](https://docs.nestjs.com/fundamentals/testing), dan [Vitest/SWC](https://docs.nestjs.com/recipes/swc#vitest). Jangan menambahkan microservices atau queue broker hanya karena framework mendukungnya.

## Kontrak bersama dan alur command

Task 1 membuat `packages/shared/src/contracts.ts` untuk `Id = string`, `Locale = 'en' | 'id'`, dan tipe JSON. Task 2 menambah `Principal { accountId: Id }`, `Member { campaignId, accountId, role: 'dm'|'player' }` dan `ApiError { code: string, params: Record<string,string|number> }`; error dikirim sebagai kode/parameter, bukan kalimat dengan bahasa DM.

Task 3 menetapkan kontrak di `packages/shared/src/commands.ts`:

- `CommandEnvelope { requestId, campaignId, targetId, kind, expectedRevision?: number, payload: JsonValue }`. Untuk mutasi existing entity, expectedRevision adalah versi entity target, bukan nomor seluruh room.
- `CommandResult { targetId, entityRevision, eventSequence, value: JsonValue }`. eventSequence monoton per campaign; bukan field rahasia yang mengandung payload DM.
- `CommandContext { db, principal, member, now }`, dengan `now` dari server. `CommandHandler = (ctx: CommandContext, payload: JsonValue) => JsonValue`; validasi kind-specific sebelum handler, dan tidak ada `await`/I/O jaringan dalam transaksi.
- `registerCommand(kind: string, handler: CommandHandler): void`; `executeCommand(principal: Principal, command: CommandEnvelope): CommandResult`; handler fitur dipanggil dari dispatcher yang sama untuk seluruh mutasi gameplay.
- `projectRoom(principal: Principal, campaignId: Id): RoomSnapshot`; `RoomSnapshot { campaignId, eventSequence, ...visible room data }` didefinisikan di `packages/shared/src/room.ts` dan diperluas bersama fitur.

Kepemilikan tipe lintas task: Task 5 membuat `ContentEntry`, `ContentCatalog`, `ContentAudit` dan `ValidationResult` di `packages/shared/src/content.ts`; Task 7 membuat `Character`, `CharacterDraft`, `DerivedCharacter`, dan Task 8–10 memperluas `FeatureUse`, `SpellcastingState`, `AdvancementChoice`, `AdvancementPreview` di `characters.ts`. Task 11 membuat `NoteDraft`/`NoteSummary` di `notes.ts`; Task 12 membuat `EncounterEstimate`/`MonsterInstance` di `encounters.ts`; Task 13–14 membuat `AssetUpload`, `Asset`, `SceneView`, `Token`, `GridPoint`, `GridSettings`, `MoveTokenInput` di `scenes.ts`. Task 15–18 memiliki `Combat`, `RollResult`, `D20Input`, `D20Result`, `HitPointState`, `DamageInput`, `ActionInput`, `ActionPreview`, `ResolutionDecision`, `Resolution` di `combat.ts`; `RandomInt` adalah signature randomInt Task 16. Task 19 memiliki `PlaySession`/`SessionView` di `sessions.ts`; Task 21 memiliki `ArchiveInput`, `ImportPreview`, `ExportArtifact` di `backups.ts`. File feature mengimpor tipe tersebut dan tidak mendefinisikan ulang kontrak yang berbeda.

Alur: autentikasi/origin -> membership/ownership -> validasi payload -> cek receipt actor/request -> cek entity revision -> transaksi state/event/receipt -> commit -> ack -> snapshot/projection per penerima. Periksa akses sebelum mengembalikan receipt. Payload berbeda untuk requestId sama ditolak. Hasil roll dan ID resolution disimpan dalam receipt agar retry tidak membuat roll baru.

Gunakan `POST /api/campaigns/:campaignId/commands` sebagai ingress mutasi gameplay; Socket.IO mengirim notifikasi `room:changed` setelah commit. Notifikasi hanya memuat campaignId/eventSequence, tidak payload rahasia. Client mengambil `GET /api/campaigns/:campaignId/snapshot` dengan projection terbaru; pemilahan/pagination data besar diperbolehkan tanpa mengubah kontrak privasi. Ini menyederhanakan recovery rilis pertama; optimasi patch hanya jika pengukuran menunjukkan kebutuhan.

## Cara menjalankan tugas

Setiap task memiliki siklus red/green dan commit tersendiri. Perintah `npm run test -- <file>` menjalankan Vitest; `npm run test:e2e -- <file>` menjalankan Playwright. Task 1 membuat script tersebut. Jalankan hanya gate yang relevan setelah tiap perubahan; suite menyeluruh pada Task 22–23.

Workspace belum memiliki Git repository. Saat eksekusi, periksa instruksi/environment dan skill worktree sebelum membuat repository/branch; jangan menyentuh koleksi referensi atau menganggap commit sudah tersedia. Setiap langkah commit di bawah berlaku saat metadata Git dapat ditulis. Bila kebijakan menghalangi, simpan perubahan dan laporkan batasnya, tanpa mengulang permintaan izin yang otomatis ditolak.

## Tahap 1 — Host, campaign dan multiplayer

### Task 1: Host persisten dan test harness

**Files:** Create `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/app.ts`, `app.module.ts`, `app.controller.ts`, `index.ts`, `apps/server/src/db/database.ts`, `database.module.ts`, `database.service.ts`, `migrate.ts`, `backup.ts`, `migrations/001-host.sql`, `packages/shared/src/contracts.ts`, `tests/helpers/server.ts`. Test `apps/server/src/app.test.ts`.

**Interfaces:** `openDatabase(dataDir: string): DatabaseSync`; `migrate(db: DatabaseSync): void`; `backupDatabase(db: DatabaseSync, targetPath: string): Promise<void>`; `createApp(options: { dataDir: string }): Promise<NestFastifyApplication>`. Test helper uses `@nestjs/testing`, initializes Nest dan menunggu Fastify `.ready()` sebelum `app.inject()`, lalu `app.close()` untuk temporary data directory. Root scripts: dev, build, start, typecheck, test, test:e2e, content:audit.

- [x] Siapkan harness minimal dan failing test `keeps_host_identity_after_reopen`: `expect(reopened.hostId).toBe(first.hostId)`; health endpoint tidak mengungkap path/secret. Tambahkan `boots_nested_injected_providers` untuk membuktikan metadata injection pada test runner dan hasil build. Ini menguji persistence/boot nyata, bukan file konfigurasi.
- [x] Jalankan `npm run test -- apps/server/src/app.test.ts`; pastikan gagal pada kontrak aplikasi/persistence yang belum dibuat, bukan karena dependency/harness rusak.
- [x] Implementasikan bootstrap Nest/Fastify, AppModule/DatabaseModule, provider singleton dan shutdown hooks; prepared SQL/migrations atomik, foreign keys, WAL dan data directory eksplisit. Sebelum memigrasi database existing, `createApp` menunggu backup konsisten dan gagal start bila backup gagal. Konfigurasikan SWC/reflect-metadata untuk test, frontend build dari output tertentu, serta tooling/lockfile yang diperlukan deliverable ini.
- [x] Jalankan test yang sama serta `npm run typecheck`; expected exit 0. Uji kegagalan migrasi tidak meninggalkan schema setengah terpasang, `GET /api/unknown` tetap JSON 404, dan shutdown menutup database. Jika frontend build belum ada pada tahap ini, health/API dapat berjalan tanpa membuat fallback palsu; sajikan output Vite setelah Task 4 tersedia.
- [x] Commit `feat: add persistent application host`.

### Task 2: Akun, undangan, campaign dan ownership

**Files:** Create `apps/server/src/features/auth/service.ts`, `auth.module.ts`, `auth.controller.ts`, `session.guard.ts`, `principal.ts`, `apps/server/src/features/campaigns/service.ts`, `campaigns.module.ts`, `campaigns.controller.ts`, `access.ts`, `apps/server/src/common/api-error.filter.ts`, `schema-validation.pipe.ts`, `apps/server/src/db/migrations/002-accounts-campaigns.sql`, `packages/shared/src/access.ts`. Test `apps/server/src/features/campaigns/access.test.ts`.

**Interfaces:** `registerInvitedAccount(invite: string, username: string, password: string): Promise<Principal>`; `requireMember(principal: Principal, campaignId: Id): Member`; `createCampaign(principal: Principal, title: string): Id`. Bootstrap first owner is one-time. Password hashing uses asynchronous Node scrypt with per-user salt, di luar transaksi, lalu validasi undangan ulang saat commit; opaque auth sessions stored server-side and revocable. Ownership karakter diperkenalkan Task 7 setelah schema karakter tersedia, bukan mengakses tabel yang belum dibuat.

- [x] Tulis `rejects_cross_campaign_and_role_escalation`: `expect(player.role).toBe('player')`; campaign lain, owner ID palsu dan undangan dicabut semuanya menghasilkan `FORBIDDEN`/`INVITE_INVALID` tanpa detail rahasia.
- [x] Run `npm run test -- apps/server/src/features/campaigns/access.test.ts`; expected FAIL sebelum implementasi.
- [x] Implementasikan bootstrap, login/logout, undangan, membership, pencabutan anggota dan kontrak error; cookie HttpOnly/SameSite, Secure saat HTTPS; validasi origin/CSRF dan rate limit login/join.
- [x] Run test sama; expected PASS, termasuk restart/login ulang tetap memiliki keanggotaan dan DM yang sama.
- [x] Commit `feat: add campaign identities and access`.

### Task 3: Transaksi command, projection dan reconnect

**Files:** Create `packages/shared/src/commands.ts`, `room.ts`, `apps/server/src/commands/dispatcher.ts`, `registry.ts`, `commands.module.ts`, `commands.controller.ts`, `apps/server/src/realtime/rooms.gateway.ts`, `realtime.module.ts`, `projection.ts`, `apps/server/src/db/migrations/003-command-events.sql`. Test `apps/server/src/commands/dispatcher.test.ts`.

**Interfaces:** Kontrak `registerCommand`, `executeCommand`, `projectRoom` di atas; HTTP snapshot/command dan Socket.IO `room:changed`. Auth/membership Task 2 dipakai pada subscribe, snapshot, command dan receipt.

- [x] Tulis `retries_once_after_lost_ack`: dua command dengan requestId/payload sama menghasilkan `expect(second).toEqual(first)` dan satu event; stale revision gagal; rollback tidak mengubah state/receipt.
- [x] Run `npm run test -- apps/server/src/commands/dispatcher.test.ts`; expected FAIL.
- [x] Implementasikan CommandsModule/RealtimeModule, dispatcher provider, HTTP controller dan RoomsGateway, transaksi state/event/receipt, payload fingerprint, revision, projection per peserta dan reconnect snapshot. Socket memakai session/origin/membership yang sama; cabut subscription saat akses dicabut. Mutation baru saat disconnected ditolak client, tidak masuk buffer socket.
- [x] Run test sama; expected PASS termasuk member yang dicabut tidak memperoleh receipt lama, serta perubahan tidak diumumkan sebelum commit.
- [x] Commit `feat: add authoritative room commands`.

### Task 4: Shell responsif dan EN/ID per pengguna

**Files:** Create `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/src/app/App.tsx`, `router.tsx`, `api.ts`, `room-store.ts`, `i18n.ts`, `apps/web/src/locales/en/common.json`, `apps/web/src/locales/id/common.json`, `apps/web/src/features/lobby/Lobby.tsx`, `scripts/audit-locales.ts`. Test `apps/web/src/app/i18n.test.tsx`.

**Interfaces:** `setLocale(locale: Locale): void`; `useRoom(campaignId: Id): RoomSnapshot | undefined`; API wrapper consumes Task 2 error codes and Task 3 snapshot/command contracts. Preferensi bahasa tersimpan per akun; sebelum login gunakan browser preference dengan fallback EN.

- [x] Tulis `switches_locale_without_losing_draft`: `expect(draftAfter).toEqual(draftBefore)` dan label berubah EN/ID; parameter terjemahan sama; no secret in room store.
- [x] Run `npm run test -- apps/web/src/app/i18n.test.tsx`; expected FAIL.
- [x] Implementasikan shell/login/lobby dan navigation role, status koneksi/save/error, dialog aksesibel, locale switch dan catalog lokal; tambahkan EN/ID bersama setiap UI task berikutnya. Konfigurasikan proxy Vite untuk API/Socket.IO saat development, dan penyajian hasil build Vite dari host Nest untuk pengujian produksi berikutnya; frontend fallback tidak menelan API/asset privat.
- [x] Run test sama dan locale audit; expected PASS untuk ID/EN/browser lain, termasuk keyboard dan text panjang.
- [x] Commit `feat: add bilingual campaign shell`.

**Gate tahap:** DM dan dua player memakai browser berbeda, room/data bertahan setelah restart, role terjaga dan bahasa dapat berbeda.

## Tahap 2 — Corpus, pencarian dan karakter

### Task 5: Pipeline corpus SRD dan terjemahan

**Files:** Create `packages/content/src/schema.ts`, `catalog.ts`, `packages/content/source/srd-5.2.1-manifest.json`, `packages/content/data/en/rules.json`, `characters.json`, `spells.json`, `items.json`, `monsters.json`, pasangan file `data/id/`, `packages/content/data/attribution.json`, `scripts/audit-content.ts`. Test `packages/content/src/catalog.test.ts`. Create `apps/server/src/content/content.module.ts`, `content.service.ts`; register ContentModule pada AppModule.

**Interfaces:** `getContent(id: Id, locale: Locale): ContentEntry`; `auditContent(): ContentAudit`; `ContentEntry` dan kind-specific mechanics schemas di `packages/shared/src/content.ts` memisahkan localized label/body dari numeric mechanics/provenance. `ContentAudit { missingIds, missingLocales, invalidReferences, mechanicMismatches }` berisi daftar masalah.

- [x] Buat manifest ekspektasi berdasarkan bagian sumber SRD resmi, catat section/page/hash/version; test `requires_all_manifest_entries_in_both_locales`: semua daftar audit harus `[]`. Manifest dibaca/diperiksa independen dari hasil ingest, bukan dibuat hanya dari entri yang kebetulan tersedia.
- [x] Run `npm run test -- packages/content/src/catalog.test.ts`; expected FAIL dengan kekurangan nyata, bukan melemahkan ekspektasi ke corpus sampel.
- [x] Ingest/review bertahap aturan, seluruh opsi/progression karakter SRD, spells, equipment/magic items dan monsters ke EN/ID; simpan attribution/penanda terjemahan. Angka/formula tidak diduplikasi dalam dua locale. Fitur yang belum otomatis tetap memiliki teks dan mekanik resource terstruktur.
- [ ] Run `npm run test -- packages/content/src/catalog.test.ts` dan `npm run content:audit`; expected PASS hanya setelah cakupan lengkap. Gunakan fixture sumber dan sampling visual lintas kategori; hasil OCR tidak dianggap benar tanpa pemeriksaan.
- [x] Commit per kategori yang sudah diaudit `feat: add verified bilingual SRD corpus`; gate task tetap terbuka sampai semua kategori lengkap. Tidak menjadikan seluruh library PDF pengguna sebagai asset produk.

### Task 6: Reference reader dan pencarian istilah pemula

**Files:** Create `packages/content/data/glossary.json`, `apps/server/src/features/reference/search.ts`, `apps/web/src/features/reference/ReferenceReader.tsx`, `SearchPanel.tsx`. Test `apps/server/src/features/reference/search.test.ts`. Create `apps/server/src/features/reference/reference.module.ts`, `reference.controller.ts`; import ContentModule dan AuthModule.

**Interfaces:** `searchReference(principal: Principal, query: string, locale: Locale, campaignId?: Id): SearchHit[]`; `SearchHit { entryId, title, originalTitle, summary, whenToUse, relatedIds, source }`. MiniSearch index corpus yang boleh diakses; aliases/frasa pemula dikurasi, bukan AI.

- [x] Tulis `finds_beginner_aliases_without_private_notes`: `expect(ids('darah')).toContain('rule.hit-points')`; `nyawa`/`HP` menuju entri sama; `giliran saya bisa apa` menuju panduan turn; query rahasia DM tidak muncul bagi player.
- [x] Run `npm run test -- apps/server/src/features/reference/search.test.ts`; expected FAIL.
- [x] Implementasikan normalisasi EN/ID, exact/alias lebih tinggi daripada fuzzy, typo/prefix terbatas, kosong/no result, bookmark dan help links; tampilkan ringkasan, konteks, teks sumber dan langkah berikutnya. Tautan aksi membuka review, tidak otomatis menghabiskan resource.
- [x] Run test sama; expected PASS termasuk ID dengan original EN, fallback homebrew berlabel, query panjang dan scope campaign lain.
- [x] Commit `feat: add beginner reference search`.

### Task 7: Wizard karakter dan perhitungan dasar

**Files:** Create `packages/shared/src/characters.ts`, `packages/rules/src/abilities.ts`, `character-stats.ts`, `apps/server/src/features/characters/service.ts`, `apps/web/src/features/characters/CharacterWizard.tsx`, `CharacterSheet.tsx`, migration `005-characters.sql` (004 dipakai bookmark referensi). Test `packages/rules/src/character-stats.test.ts`, `apps/server/src/features/characters/service.test.ts`. Create `apps/server/src/features/characters/characters.module.ts`, `characters.controller.ts`; import ContentModule, CommandsModule dan CampaignsModule.

**Interfaces:** `abilityModifier(score: number): number`; `deriveCharacter(character: Character, catalog: ContentCatalog): DerivedCharacter`; `saveCharacterDraft(ctx: CommandContext, draft: CharacterDraft): Id`; `requireCharacterOwner(principal: Principal, characterId: Id): Member` di service karakter. Character includes ownership, class levels, origin choices and source IDs; derived fields separate base from DM override.

- [x] Tulis `derives_stats_from_origin_and_equipment`: `expect(abilityModifier(16)).toBe(3)`; `expect(abilityModifier(8)).toBe(-1)`; wizard tidak final tanpa pilihan wajib, draft pulih setelah reload, player lain tidak dapat mengedit.
- [x] Run kedua file test; expected FAIL.
- [x] Implementasikan standard array/point buy/roll tercatat, class/background/species/languages, origin feat dan equipment, skill/save/AC/HP/speed/initiative; konsep, motivasi dan party bonds; validasi pilihan/prerequisite dari corpus. Tambahkan transfer karakter eksplisit oleh DM dan penolakan edit oleh owner lama.
- [x] Run test sama; expected PASS dengan fixture equipment/armor training dan DM override; UI EN/ID menunjukkan asal kontribusi angka.
- [x] Commit `feat: add guided character creation`.

### Task 8: Fitur class, Weapon Mastery dan Heroic Inspiration

**Files:** Create `packages/rules/src/class-features.ts`, `weapon-mastery.ts`, `apps/server/src/features/characters/features.ts`, `apps/web/src/features/characters/FeatureList.tsx`. Test `packages/rules/src/class-features.test.ts`. Modify `apps/server/src/features/characters/characters.module.ts` untuk provider fitur class dan registration command pada module init.

**Interfaces:** `availableFeatures(character: Character, catalog: ContentCatalog): FeatureUse[]`; `FeatureUse` didefinisikan di `characters.ts` dengan sourceId, action type, resource cost/recovery, automation level dan teks referensi; `validateFeatureUse(character: Character, featureId: Id): ValidationResult`.

- [x] Tulis `uses_2024_features_and_recovery`: fitur/mastery yang tidak dimiliki ditolak; Inspiration dipakai satu kali; fixture SRD untuk class berbeda membuktikan recovery tidak disamaratakan.
- [x] Run `npm run test -- packages/rules/src/class-features.test.ts`; expected FAIL.
- [x] Implementasikan feature eligibility, mastery pilihan, inspiration dan per-feature recovery metadata; manual resolution tersedia untuk fitur naratif/khusus dengan resource tracker yang benar.
- [x] Run test sama; expected PASS untuk opsi yang dimiliki/belum level, duplicate grant dan override DM; audit semua class SRD memiliki progression/feature references.
- [x] Commit `feat: add class feature tracking`.

### Task 9: Inventory, spell preparation, resource dan rests

**Files:** Create `packages/rules/src/equipment.ts`, `spellcasting.ts`, `rests.ts`, `apps/server/src/features/characters/resources.ts`, `apps/web/src/features/characters/Inventory.tsx`, `Spellbook.tsx`. Test `packages/rules/src/resources.test.ts`. Modify `apps/server/src/features/characters/characters.module.ts` untuk provider resource/equipment/spell dan registration command.

**Interfaces:** `deriveSpellcasting(character: Character, catalog: ContentCatalog): SpellcastingState`; `applyRest(character: Character, rest: 'short'|'long'): Character`; `validateLoadout(character: Character): ValidationResult`. Server feature commands register pada Task 3.

- [x] Tulis `tracks_resources_without_double_spending`: jumlah inventory tidak negatif, attunement/proficiency tervalidasi, spell yang tidak tersedia ditolak, Short Rest/Long Rest mengikuti fixture class berbeda, prepared vs known tidak dicampur.
- [x] Run `npm run test -- packages/rules/src/resources.test.ts`; expected FAIL.
- [x] Implementasikan currency/equipment/attunement, spell preparation, slot/Pact Magic, concentration dan recovery; preview rest dan confirmation sesuai kebijakan DM. Pemakaian dalam combat baru committed oleh resolution Task 18.
- [x] Run test sama; expected PASS termasuk zero remaining resource, serta perubahan equipment menghitung ulang AC/attacks tanpa menghapus override.
- [x] Commit `feat: add character resources and rests`.

### Task 10: Level up dan multiclass sampai level 20

**Files:** Create `packages/rules/src/advancement.ts`, `multiclass.ts`, `apps/server/src/features/characters/advancement.ts`, `apps/web/src/features/characters/LevelUpWizard.tsx`. Test `packages/rules/src/advancement.test.ts`. Modify `apps/server/src/features/characters/characters.module.ts` untuk provider advancement dan registration command.

**Interfaces:** `previewAdvancement(character: Character, choice: AdvancementChoice, catalog: ContentCatalog): AdvancementPreview`; `applyAdvancement(character: Character, preview: AdvancementPreview): Character`. Tipe pilihan/preview ditambahkan ke `characters.ts`; server memvalidasi ulang preview saat commit.

- [x] Tulis `advances_all_srd_classes_and_multiclass`: total level tidak melebihi 20; prerequisite class/feat ditegakkan; HP/proficiency/slots/features cocok fixture sumber yang dipilih independen; pilihan yang kurang tetap draft.
- [x] Run `npm run test -- packages/rules/src/advancement.test.ts`; expected FAIL.
- [x] Implementasikan XP/milestone setting, subclass/feat/ability improvements, memulai di level lebih tinggi, multiclass slot/proficiency dan class resources; tampilkan before/after sebelum commit.
- [x] Run test sama; expected PASS untuk tiap class/subclass SRD dan kombinasi caster/Pact Magic serta koreksi DM tercatat.
- [x] Commit `feat: add character advancement`.

**Gate tahap:** karakter SRD dapat dibuat/dikembangkan, corpus EN/ID lengkap dan pencarian pemula berjalan tanpa internet; keberhasilan beberapa contoh class tidak menutup gate.

## Tahap 3 — Persiapan DM

### Task 11: Penulisan cerita, NPC, quest, handout dan cheat sheet

**Files:** Create `packages/shared/src/notes.ts`, `apps/server/src/features/notes/service.ts`, `projection.ts`, `apps/web/src/features/notes/StoryEditor.tsx`, `PartyJournal.tsx`, `DmCheatSheet.tsx`, migration `005-notes.sql`. Test `apps/server/src/features/notes/visibility.test.ts`. Create `apps/server/src/features/notes/notes.module.ts`, `notes.controller.ts`; import CommandsModule dan CampaignsModule.

**Interfaces:** `saveNote(ctx: CommandContext, note: NoteDraft): Id`; `visibleNotes(principal: Principal, campaignId: Id): NoteSummary[]`; Note kinds: world/chapter/scene/NPC/location/quest/handout/ruling; visibility DM/party/specific members.

- [x] Tulis `does_not_leak_unshared_story`: player API/socket/search tidak memiliki teks rahasia, termasuk note ID ditebak; konflik dua editor tidak menimpa draft diam-diam; script/HTML dalam Markdown tidak dieksekusi.
- [x] Run `npm run test -- apps/server/src/features/notes/visibility.test.ts`; expected FAIL.
- [x] Implementasikan editor Markdown aman, autosave/revision, read-aloud/trigger/outcome/reward, link antarentri, selective share dan generator nama lokal; cheat sheet AC/HP/Passive Perception/resources memakai projection sesuai role.
- [x] Run test sama; expected PASS dengan selected-member handout dan error autosave mempertahankan draft.
- [x] Commit `feat: add campaign writing tools`.

### Task 12: Homebrew dan encounter difficulty 2024

**Files:** Create `packages/rules/src/encounter-budget.ts`, `apps/server/src/features/encounters/service.ts`, `homebrew.ts`, `apps/web/src/features/encounters/EncounterBuilder.tsx`, `HomebrewEditor.tsx`, migration `006-encounters.sql`. Test `packages/rules/src/encounter-budget.test.ts`, `apps/server/src/features/encounters/homebrew.test.ts`. Create `apps/server/src/features/encounters/encounters.module.ts`, `encounters.controller.ts`; inject ContentService dan CommandsService.

**Interfaces:** `calculateBudget(levels: number[]): { low: number, moderate: number, high: number }`; `evaluateEncounter(levels: number[], monsters: { xp: number, count: number }[]): EncounterEstimate`; `saveHomebrew(ctx: CommandContext, entry: ContentEntry): Id`. Homebrew kind schemas dari Task 5; campaign approval dan formula whitelist tanpa eval.

- [x] Tulis `uses_2024_xp_budget`: `expect(calculateBudget([1,1,1,1])).toEqual({low:200,moderate:300,high:400})`; empat musuh 50 XP berjumlah 200 tanpa multiplier; input party kosong/XP hilang ditolak.
- [x] Run dua file test; expected FAIL.
- [x] Implementasikan monster filters/duplication, party selection/level, target budget dan label sesuai spec, risiko, template instance terpisah; editor homebrew spell/item/monster/character options dengan approval DM.
- [x] Run test sama; expected PASS untuk mixed levels, exact boundary, zero XP, quantity invalid dan formula/kode tidak aman.
- [x] Commit `feat: add encounter and homebrew tools`.

**Gate tahap:** DM menyiapkan cerita dan encounter, membagikan materi terpilih dan mengakses aturan tanpa membuka rahasia ke player.

## Tahap 4 — Meja virtual dan combat

### Task 13: Asset aman, scene dan token

**Files:** Create `packages/shared/src/scenes.ts`, `apps/server/src/features/scenes/assets.ts`, `service.ts`, `projection.ts`, `apps/web/src/features/scenes/BattleMap.tsx`, `TokenPanel.tsx`, migration `007-scenes.sql`. Test `apps/server/src/features/scenes/access.test.ts`. Create `apps/server/src/features/scenes/scenes.module.ts`, `scenes.controller.ts`; register multipart Fastify yang kompatibel dengan versi Nest terpilih dan validation limits sebelum menerima upload.

**Interfaces:** `storeAsset(principal: Principal, campaignId: Id, upload: AssetUpload): Promise<Asset>`; `projectScene(principal: Principal, sceneId: Id): SceneView`; asset GET memeriksa membership/visibility, bukan akses static path. Scene coordinates disimpan dalam satuan grid, bukan pixel viewport.

- [x] Tulis `hides_tokens_and_rejects_hostile_uploads`: `expect(playerView.tokens.some(t=>t.id===hiddenId)).toBe(false)`; file type palsu, path traversal dan asset campaign lain gagal; batas awal upload 20 MiB dan 40 megapixel diuji di boundary.
- [x] Run `npm run test -- apps/server/src/features/scenes/access.test.ts`; expected FAIL.
- [x] Implementasikan upload lokal PNG/JPEG/WebP dengan validasi signature/dimensi, asset reference, grid calibration, tokens ber-owner, pan/zoom dan fallback kontrol DOM. Node:sqlite hanya metadata; bytes di direktori asset terkontrol.
- [x] Run test sama; expected PASS untuk private/public handout dan hidden monster tanpa HP/stat rahasia pada response/error.
- [x] Commit `feat: add secure scenes and tokens`.

### Task 14: Movement, jarak, ping, AoE dan reveal manual

**Files:** Create `packages/rules/src/movement.ts`, `apps/server/src/features/scenes/movement.ts`, `apps/web/src/features/scenes/MapControls.tsx`, `MeasurementLayer.tsx`, `RevealLayer.tsx`. Test `packages/rules/src/movement.test.ts`, `apps/web/src/features/scenes/MapControls.test.tsx`. Modify `apps/server/src/features/scenes/scenes.module.ts` untuk MovementService dan command registration.

**Interfaces:** `movementCost(path: GridPoint[], settings: GridSettings): number`; `moveToken(ctx: CommandContext, input: MoveTokenInput): Token`. Default: 5 feet/square, diagonal sama satu square (Chebyshev), difficult terrain dikonfigurasi DM; tersedia campaign setting alternate diagonal dan DM override dengan log.

- [x] Tulis `validates_paths_and_supports_touch`: `expect(movementCost([{x:0,y:0},{x:1,y:1}], standardGrid)).toBe(5)`; difficulty terrain naik biaya sesuai sumber; player tidak memindah token lain; tap-to-move sama hasil dengan drag.
- [x] Run dua file test; expected FAIL.
- [x] Implementasikan committed movement/measurement, ping sementara, AoE marker dan manual reveal; overlay visual tidak dipakai sebagai pengamanan gambar penuh. Map background yang dibagikan harus aman dilihat; informasi rahasia tetap pada asset terpisah dan projection server.
- [x] Run test sama; expected PASS untuk zoom/resize, movement budget, hidden entity, keyboard dan no-grid roleplay; ping tidak membuat log permanen per pointer move.
- [x] Commit `feat: add interactive map controls`.

### Task 15: Combat lifecycle, initiative dan action economy

**Files:** Create `packages/shared/src/combat.ts`, `packages/rules/src/turns.ts`, `apps/server/src/features/combat/service.ts`, `apps/web/src/features/combat/CombatTracker.tsx`, `ActionPanel.tsx`, migration `013-combat.sql` (008–012 sudah digunakan). Test `apps/server/src/features/combat/turns.test.ts`. Create `apps/server/src/features/combat/combat.module.ts`, `combat.controller.ts`; import CommandsModule serta feature providers yang dibutuhkan tanpa dependency cycle.

**Interfaces:** `startCombat(ctx: CommandContext, templateId: Id): Combat`; `advanceTurn(combat: Combat): Combat`; Combat includes instance combatants, round/activeId, budgets, hidden status and template reference.

- [x] Tulis `starts_instance_and_preserves_template`: `expect(template.hp).toBe(originalHp)` setelah damage instance; tie-break ditetapkan DM; end/start turn me-reset budget yang tepat, bukan semua limited-use resources.
- [x] Run `npm run test -- apps/server/src/features/combat/turns.test.ts`; expected FAIL.
- [x] Implementasikan start/end/pause combat, initiative, next turn/round, reinforcement dan action/bonus/reaction/movement tracker; hidden combatant tetap tersaring dari urutan player.
- [x] Run test sama; expected PASS untuk creature dihapus/mati pada giliran, urutan kosong dan correction DM tercatat.
- [x] Commit `feat: add combat turn management`.

Catatan implementasi: combat dimulai dalam fase persiapan initiative, lalu DM memulai ronde pertama. Token yang dibuat dari UI peta dihubungkan melalui panel penyesuaian combat; HP dan movement memakai sumber yang sama. Koreksi HP karakter memerlukan `sourceRevision` sheet selain revisi combat agar perubahan sheet yang lebih baru tidak tertimpa. Creature pada HP 0 dikeluarkan dari urutan hanya setelah DM menandainya keluar dari combat; death saves berada pada Task 16.

### Task 16: Dadu server dan hasil checks/attacks/saves

**Files:** Create `packages/rules/src/dice.ts`, `damage.ts`, `apps/server/src/features/combat/rolls.ts`, `apps/web/src/features/combat/DiceTray.tsx`, `RollDetails.tsx`. Test `packages/rules/src/dice.test.ts`, `apps/server/src/features/combat/rolls.test.ts`. Modify `apps/server/src/features/combat/combat.module.ts` untuk RollsService dan server-only random provider.

**Interfaces:** `rollDice(expression: string, randomInt: (min:number,maxExclusive:number)=>number): RollResult`; `resolveD20(input: D20Input, randomInt: RandomInt): D20Result`; `applyDamage(state: HitPointState, input: DamageInput): HitPointState`. Type definitions in `packages/shared/src/combat.ts`; crypto.randomInt is production source, injectable deterministic generator only in tests.

- [x] Tulis `validates_dice_and_applies_critical_dice`: `2d6+3` dengan kedua dadu 1 menghasilkan 5; expression/code invalid ditolak; advantage/disadvantage mengikuti fixture; critical menggandakan damage dice, bukan modifier.
- [x] Run dua file test; expected FAIL.
- [x] Implementasikan grammar dadu terbatas (maksimum awal 100 dice, 1.000 sides, ekspresi 100 karakter), attack/check/save/heal, HP/temp HP/conditions/death saves dan resistance/immunity/vulnerability sesuai data; duplicate requestId mengembalikan roll lama.
- [x] Run test sama; expected PASS untuk audience DM/public, invalid modifier/dice counts dan deterministic fixtures. Raw rolls tidak otomatis memakai slot tanpa action/resolution.
- [x] Commit `feat: add authoritative dice and damage`.

Catatan implementasi: migrasi `014-rolls-vitals.sql` menyimpan history roll dan vitals monster; vitals karakter tetap pada resources sheet. Modifier d20 dimasukkan manual. Roll bersifat independen dari biaya dan efek; DM menerapkan damage/heal/temp HP secara eksplisit. Defense monster dibaca dari data terstruktur, sedangkan defense karakter/efek sementara dapat memakai profil override DM. Kondisi dicatat; pembatasan aksi dan Speed 0 dasar diterapkan sesuai SRD 2024. Efek fitur/condition lainnya tetap diputuskan di meja sampai guided actions tersedia. Death save dikunci per combat dan turn, bukan nomor turn global; retry UI memakai envelope asli saat hasil command belum pasti.

### Task 17: Spell/feature actions dan penggunaan monster

**Files:** Create `packages/rules/src/actions.ts`, `monster-actions.ts`, `apps/server/src/features/combat/actions.ts`, `apps/web/src/features/combat/ActionWizard.tsx`. Test `packages/rules/src/actions.test.ts`. Modify `apps/server/src/features/combat/combat.module.ts` untuk ActionsService; perhitungan murni tetap pada packages/rules.

**Interfaces:** `previewAction(actor: Character|MonsterInstance, input: ActionInput, view: SceneView): ActionPreview`; `ActionPreview` contains sourceId, target IDs, cost, automation level, required saves/rolls/effects and DM decision prompts. Semua target divalidasi ulang di server, bukan dipercaya dari preview client.

- [x] Tulis `supports_non_damage_and_restricted_actions`: action yang habis/target tersembunyi ditolak; spell buff/heal/utility tidak diperlakukan sebagai attack damage; monster Multiattack/Recharge/Legendary Action mengikuti stat block dan budgetnya.
- [x] Run `npm run test -- packages/rules/src/actions.test.ts`; expected FAIL.
- [x] Implementasikan attack/spell/feature guided steps, range/cost/resource, upcast, concentration, duration dan penggunaan monster. Fitur kompleks menawarkan rule text + manual decision, dengan label batas otomasi.
- [x] Run test sama; expected PASS untuk average-vs-roll damage, reaction trigger, insufficient slot dan fitur naratif yang tetap dapat dijalankan DM.
- [x] Commit `feat: add guided gameplay actions`.

Catatan implementasi: migrasi `015-actions.sql` menyimpan pemakaian Recharge, per hari, Legendary Action dan jatah serangan per combatant. Aksi monster dibaca dari teks stat block SRD 2024 (EN) karena mechanics monster tidak memiliki daftar aksi; kalimat yang tidak dikenali tetap menjadi teks aturan + keputusan DM. `previewAction` memakai `ActionActor`/`ActionView` ternormalisasi (sheet atau stat block + budget combat, target yang terlihat). Server membangun ulang preview dari state sendiri pada `combat.act`, memakai biaya dalam transaksi command, melempar dadu server, dan mengembalikan usulan HP yang diterapkan DM melalui `combat.apply-hp`. Recharge dilempar pada awal giliran monster. Salinan player tidak memuat AC, modifier save atau dadu save monster.

### Task 18: Pending resolution, reaksi dan efek tepat sekali

**Files:** Create `apps/server/src/features/combat/resolutions.ts`, `effects.ts`, `apps/web/src/features/combat/ResolutionPanel.tsx`, migration `009-resolutions.sql`. Test `apps/server/src/features/combat/resolutions.test.ts`, `tests/e2e/reconnect-resolution.spec.ts`. Modify `apps/server/src/features/combat/combat.module.ts` untuk ResolutionsService dan effects providers.

**Interfaces:** `beginResolution(ctx: CommandContext, input: ActionInput): Resolution`; `decideResolution(ctx: CommandContext, input: ResolutionDecision): Resolution`; `Resolution { id, phase, actorId, costs, pendingReactions, committedEffects, cancellationPolicy }`. Tipe di `combat.ts`; command receipts Task 3 berlaku pada setiap transisi.

- [x] Tulis `survives_lost_ack_restart_and_locale_switch`: retry tidak memakai dua slot/damage; resume mempertahankan pending reaction; `expect(hpAfterRetry).toBe(hpAfterFirstCommit)`; locale switch tidak mengubah phase/cost.
- [x] Run unit dan E2E tersebut; expected FAIL.
- [x] Implementasikan state machine pending/awaitingDecision/resolved/cancelled. `beginResolution` dipanggil setelah actor mengonfirmasi aksi valid dan mengonsumsi biaya dalam transaksi yang membuat resolution; preview tidak memakai biaya. Penyelesaian tidak mengonsumsi ulang. Cancellation default tidak refund; pengecualian aturan atau koreksi DM beralasan mencatat pengembalian secara eksplisit. DM correction memakai event kompensasi. Matikan speculative combat mutations saat disconnected.
- [x] Run test sama; expected PASS untuk crash setelah commit sebelum ack, actor keluar, DM membatalkan serta keputusan stale ditolak.
- [x] Commit `feat: add durable action resolutions`.

Catatan implementasi: migrasi `016-resolutions.sql` (nomor 009 sudah dipakai). `combat.act` menjadi `beginResolution`: biaya dipakai, dadu dilempar dan resolusi dibuat dalam satu transaksi; reaksi target (opsi Reaction dengan trigger yang masih bisa dipakai) ditawarkan untuk aksi publik yang memiliki attack/save. Reaksi dideklarasikan lewat `combat.act` dengan `respondsTo`. Keputusan `resolution.decide` (decline/commit/cancel/compensate) menargetkan ID resolusi sehingga revisi basi ditolak. Commit menerapkan HP melalui `EffectsService` tepat sekali dan mencatat sebelum/sesudah; kompensasi mengembalikan selisih tersebut. Penerapan HP langsung dari wizard dihapus. E2E Playwright berjalan terhadap hasil build dengan data dir sementara (`scripts/e2e-server.mjs`).

**Gate tahap:** party menyelesaikan eksplorasi dan combat dari perangkat berbeda, termasuk aksi non-damage, reconnect, hidden info dan adjudikasi DM.

## Tahap 5 — Kelanjutan campaign, audit dan distribusi

### Task 19: Play session, recap dan pause/resume

**Files:** Create `packages/shared/src/sessions.ts`, `apps/server/src/features/sessions/service.ts`, `apps/web/src/features/sessions/SessionJournal.tsx`, migration `010-play-sessions.sql`. Test `apps/server/src/features/sessions/resume.test.ts`. Create `apps/server/src/features/sessions/sessions.module.ts`, `sessions.controller.ts`; inject existing combat/scene projections.

**Interfaces:** `startSession(ctx: CommandContext, campaignId: Id): PlaySession`; `pauseSession(ctx: CommandContext, sessionId: Id): PlaySession`; `resumeSession(principal: Principal, sessionId: Id): SessionView`. Session links existing scene/combat/resolutions, bukan membuat salinan state yang dapat bertentangan.

- [x] Tulis `resumes_committed_state_after_host_restart`: `expect(resumed.turnId).toBe(saved.turnId)` dan HP/tokens/resources/pending resolution sama; recap rahasia disaring.
- [x] Run `npm run test -- apps/server/src/features/sessions/resume.test.ts`; expected FAIL.
- [x] Implementasikan session lifecycle, waktu/recap/journal, log terstruktur yang dirender EN/ID per peserta, serta referensi keputusan aturan untuk dicek setelah sesi.
- [x] Run test sama; expected PASS untuk campaign tanpa active combat, draft belum di-ack dan resume session yang telah berakhir.
- [x] Commit `feat: add session history and resume`.

Catatan implementasi: migrasi `017-play-sessions.sql` (nomor 010 sudah dipakai). `resumeSession(principal, campaignId, sessionId)` membaca combat, scene dan resolusi melalui proyeksi yang sudah ada; sesi hanya menyimpan tautan `sceneId`/`combatId`, waktu bermain per segmen, recap (bagian party dan khusus DM), journal (party/pribadi) dan pertanyaan aturan. Jeda sesi menjeda combat yang berjalan dan lanjut sesi menjalankannya lagi. Log sesi berasal dari `campaign_events` dalam rentang sequence sesi; player hanya menerima jenis peristiwa umum tanpa data. Recap memakai autosave dengan revisi sehingga draft yang belum di-ack tidak pernah menimpa versi lebih baru.

### Task 20: Tutorial orisinal dan perjalanan pemula

**Files:** Create `packages/content/data/tutorial/en.json`, `id.json`, `apps/server/src/features/campaigns/tutorial.ts`, `tests/e2e/first-adventure.spec.ts`. Modify `apps/server/src/features/campaigns/campaigns.module.ts` untuk TutorialService; endpoint tetap terautentikasi.

**Interfaces:** `createTutorialCampaign(principal: Principal, locale: Locale): Id`; tutorial instantiates existing NPC/quest/scene/encounter services dan menggunakan stable content IDs, bukan special-case engine.

- [ ] Tulis E2E: DM menyiapkan hook, dua player membuat karakter/motivasi/ikatan, menerima quest, melakukan check, menjalani tutorial combat, mendapat reward/progression dan menyimpan recap dalam EN/ID.
- [ ] Run `npm run test:e2e -- tests/e2e/first-adventure.spec.ts`; expected FAIL.
- [ ] Tulis adventure/aset orisinal dua bahasa dan help pointers; DM tetap bisa melewati tutorial, mengimprovisasi atau mengubah encounter tanpa merusak session.
- [ ] Run E2E sama; expected PASS dengan tidak ada tombol inti yang hanya dekorasi, serta source attribution referensi tersedia.
- [ ] Commit `feat: add first adventure onboarding`.

### Task 21: Ekspor/impor campaign dan backup konsisten

**Files:** Create `packages/shared/src/backups.ts`, `apps/server/src/features/backups/archive.ts`, `service.ts`, `apps/web/src/features/backups/BackupPanel.tsx`. Test `apps/server/src/features/backups/archive.test.ts`. Create `apps/server/src/features/backups/backups.module.ts`, `backups.controller.ts`; streaming export dan import tetap melalui akses DM.

**Interfaces:** `exportCampaign(principal: Principal, campaignId: Id): Promise<ExportArtifact>`; `inspectArchive(input: ArchiveInput): Promise<ImportPreview>`; `importCampaign(principal: Principal, input: ArchiveInput): Promise<Id>`. Archive stores manifest/schema/ruleset/content versions, rows and referenced assets; credentials/active invitations are excluded.

- [ ] Tulis `imports_atomically_without_credentials`: round-trip relasi/asset/turn tetap utuh; malicious path, future schema, invalid reference atau arsip terpotong menghasilkan zero new campaign; akun/cookie/undangan aktif tidak terdapat pada archive.
- [ ] Run `npm run test -- apps/server/src/features/backups/archive.test.ts`; expected FAIL.
- [ ] Gunakan `backupDatabase` Task 1 dan tambahkan staged archive/asset checksums, total uncompressed limit awal 512 MiB, validasi/migrasi dan transaksi impor; importer jadi DM, anggota placeholder dan karakter ditetapkan ulang secara eksplisit. Ambil snapshot metadata/asset pada revision yang konsisten; bila ada perubahan saat penyusunan, ulangi atau tampilkan konflik, bukan mencampur dua state.
- [ ] Run test sama; expected PASS untuk duplicate import menjadi campaign baru, gagal menulis disk, checkpoint/backup aktif dan versi corpus yang tidak tersedia ditampilkan secara jelas sebelum impor.
- [ ] Commit `feat: add portable campaign backups`.

### Task 22: Audit content, akses, bilingual dan kapasitas

**Files:** Create `tests/e2e/access-boundaries.spec.ts`, `bilingual-mobile.spec.ts`, `room-capacity.spec.ts`, `tests/helpers/multi-client.ts`, `docs/guides/acceptance-report.md`; extend audit/test fixtures dari task pemilik masing-masing, tanpa mengganti ekspektasi agar lolos.

**Interfaces:** Menguji public API dan browser build produksi dengan data directory terisolasi; `tests/helpers/multi-client.ts` membuat context DM + N player dengan cookie terpisah.

- [ ] Tulis assertions untuk 1 DM + 8 player, snapshot/update committed sekitar 1 detik pada LAN stabil; API/socket/asset/search tidak memuat DM secret; corpus/locale lengkap, angka/efek terjemahan terjaga; HP/touch/keyboard mendukung aksi utama.
- [ ] Run `npm run test:e2e -- tests/e2e/access-boundaries.spec.ts tests/e2e/bilingual-mobile.spec.ts tests/e2e/room-capacity.spec.ts`; expected FAIL jika ada gap; baseline perangkat/jaringan dicatat sebelum mengukur.
- [ ] Perbaiki hanya task pemilik kegagalan yang terbukti; lakukan review corpus independen lintas class/spell/monster dan progression. Semua kekurangan locale/automation diklasifikasikan jujur sesuai spec, tanpa menghapus konten agar test lolos.
- [ ] Run `npm run typecheck`, `npm run build`, `npm run content:audit`, `npm run test`, `npm run test:e2e`; expected exit 0, tanpa missing required locale/content dan tanpa kebocoran akses.
- [ ] Commit `test: verify complete multiplayer workflows`.

### Task 23: Paket host Windows LAN dan deployment online

**Files:** Create `scripts/package-host.ts`, `deploy/Dockerfile`, `deploy/compose.yaml`, `deploy/Caddyfile`, `docs/guides/windows-lan.md`, `online-hosting.md`, `backup-restore.md`, `tests/e2e/offline-lan.spec.ts`, `README.md`; modify root start/build scripts sesuai paket hasil build. Modify `apps/server/src/app.module.ts` untuk ServeStaticModule dan config paket produksi; jangan mengubah API/gateway menjadi proses kedua.

**Interfaces:** Hasil distribusi memuat build frontend/backend, corpus/locale dan dependency runtime yang diperlukan. `DATA_DIR`, `HOST`, `PORT`, `PUBLIC_ORIGIN` menjadi konfigurasi; default port 3000, localhost kecuali host memilih mode LAN yang bind `0.0.0.0`. Data dipisahkan dari file aplikasi dan image.

- [ ] Tulis offline test yang memblokir egress internet tetapi mengizinkan alamat LAN host; room/karakter/reference/map/roll/save/resume harus bekerja. Uji HTTP/realtime melalui reverse proxy dengan persistent volume dan restart container.
- [ ] Run `npm run test:e2e -- tests/e2e/offline-lan.spec.ts`; expected FAIL sebelum paket/deploy tersedia.
- [ ] Implementasikan paket start yang tidak memerlukan npm install setiap sesi; jelaskan LAN IP, jaringan sama dan firewall tanpa mengubah setting otomatis. Sertakan semua asset lokal; Docker opsional untuk online, bukan syarat player/host LAN. Dokumentasikan HTTPS/origin, persistence, update dan restore.
- [ ] Run test sama, startup paket pada Windows, dan seluruh acceptance Task 22 bila runtime berubah; expected PASS. Jika publikasi hosting belum dapat dilakukan, laporkan deployment lokal/proxy yang benar-benar diuji dan endpoint publik belum diverifikasi.
- [ ] Commit `feat: package LAN and online hosting`.

## Pemetaan cakupan dan stop condition

| Kebutuhan desain | Tugas |
|---|---|
| Akun, undangan, campaign, DM/player dan persistence | 1–4 |
| SRD lengkap, provenance/errata, EN/ID, search pemula | 4–6, 22 |
| Character creation, sheet, fitur/mastery/inspiration | 7–8 |
| Equipment, spell/resources/rest, level 1–20/multiclass | 9–10 |
| Cerita, NPC, quest, handout, cheat sheet dan rulings | 11, 19 |
| Homebrew dan difficulty 2024 | 5, 12 |
| Peta, asset, token, movement, reveal dan akses | 13–14 |
| Initiative, action economy, dice, combat/spell/manual resolution | 15–18 |
| Session, recap, reconnect/restart dan tutorial | 3, 18–20 |
| Backup/import/export dan perpindahan LAN/online | 21, 23 |
| Mobile/keyboard, privacy, load, konten/terjemahan dan offline | 22–23 |

Project selesai hanya jika seluruh gate dan acceptance desain terpenuhi. Fase pertama, demo UI, corpus sampel, atau fallback EN untuk semua konten ID bukan penyelesaian project. Stack sudah ditetapkan React/NestJS; estimasi tanggal selesai masih memerlukan pemecahan pekerjaan corpus/terjemahan berdasarkan manifest sumber yang nyata.

## Self-review perencanaan

- Cakupan: setiap modul desain memiliki task pemilik pada tabel; seluruh rilis tetap mencakup semua tahap.
- Kontrak: mutasi gameplay memakai satu dispatcher; expectedRevision adalah entity revision, eventSequence adalah urutan campaign; identity/data tidak bergantung locale. Nest controller/gateway memakai provider/access services yang sama; lifecycle, static routing dan decorator metadata memiliki gate test sebelum fitur yang bergantung padanya.
- Review Focus: lima kondisi penting memiliki assertions pada tugas pemilik, termasuk scope pencarian dan asset, lost ack, draft locale, import gagal, serta perubahan makna/angka terjemahan.
- Batas status: perintah test di dokumen adalah rencana, belum dijalankan terhadap aplikasi yang belum dibuat. Tidak ada klaim build/test aplikasi telah lulus atau endpoint sudah online.
- Catatan eksekusi: task besar corpus/rules perlu dipecah menjadi batch bertanggung jawab per kategori/class bila ukuran perubahan menghalangi review; interface dan gate task tetap dipertahankan. Ini tidak memberi izin mengurangi cakupan ke sampel.

## Execution handoff

Stack React frontend + NestJS backend telah diperjelas pengguna. Rencana telah dicocokkan dengan NestJS. Langkah berikutnya adalah review rencana dan pemilihan metode eksekusi sebelum menulis kode, sesuai Superpowers writing-plans.

- **Native:** implementasi oleh agen utama dalam sesi ini, dengan review terpisah pada hasil keseluruhan. Rekomendasi untuk awal fondasi karena kontrak persistence/akses/command saling terkait dan perlu konsistensi.
- **Subagent-driven:** implementer dan reviewer terpisah per task; review lebih sering, dengan biaya context tambahan. Cocok setelah kontrak stabil atau jika pengguna mengutamakan review independen per task.

Jangan otomatis melakukan publikasi, pembelian hosting, atau mengganti keputusan React/NestJS. Mengimplementasikan kode baru hanya setelah review rencana dan metode eksekusi yang diminta skill terpenuhi.
