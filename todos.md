# 1- Frontend Integration Todo

## Amac

Bu projeye Next.js kullanmadan hafif bir frontend eklemek. Frontend, mevcut MCP/HTTP server icinden statik dosya olarak servis edilecek ve Blueprint mimarisini gorsel olarak incelemek icin kullanilacak.

Frontend musteriler icin degil, projeyi kullanan vibecoder/agent kullanicisi icindir. Bu nedenle runtime image boyutu, kurulum basitligi ve bakim kolayligi Next.js ozelliklerinden daha onemlidir.

## Aldigimiz Kararlar

- Next.js bu kullanim icin fazla agir; yerine React + Vite + Tailwind SPA kullanilacak.
- Eski `atlas-frontend` uygulamasi birebir tasinmayacak; yalnizca Blueprint UI icin ise yarayan tasarim, animasyon ve yardimci kod parcalari uyarlanacak.
- Framer Motion animasyonlari ve lucide ikonlari korunacak.
- Frontend npm paketi icinde hazir build edilmis statik dosya olarak gelecek; kullanici tarafinda Vite calismayacak.
- Docker zorunlu olmayacak; npm/npx ile calisma desteklenecek.
- Frontend veriyi runtime'da mevcut HTTP endpoint'lerinden cekecek; Blueprint verisi degistiginde frontend rebuild gerekmeyecek.
- Blueprint guncellemelerini canli yansitmak icin chat/LLM stream'inden bagimsiz bir Blueprint SSE endpoint'i eklenecek.
- Frontend chat paneli kaldirilacak; vibecoding terminal uzerinden yapilmaya devam edecek.
- HTTP uzerinden LLM chat endpoint'leri frontend tasima sirasinda kaldirilacak.
- Terminal LLM altyapisi tamamen kaldirilacak; post-commit LLM runner da bu kapsama dahil.
- `blueprint:post-commit` komutu tamamen kaldirilacak.
- Frontend icin simdilik ayri CLI komutu olmayacak.
- Frontend server acildiginda varsayilan olarak otomatik servis edilecek.
- Blueprint guncelleme bildirimi icin ilk asamada SSE yeterli kabul edilecek; SSE calismazsa periyodik polling fallback'i eklenmeyecek.
- Her gelistirme TDD yontemiyle yapilacak: once davranisi tarif eden test yazilacak, testin kirmizi oldugu gorulecek, sonra implementasyon yapilip test yesile cekilecek.

## Yapilacaklar

### Hazirlik

- [x] Degisiklikleri kucuk TDD adimlarina bol.
- [x] `atlas-frontend` icindeki Blueprint UI icin ise yarayan tasarim ve component bagimliliklarini netlestir.
- [x] Bu repoda frontend icin `frontend/` klasor yapisini belirle.
- [x] Vite, React, Tailwind ve TypeScript build akisini bu projenin mevcut `npm run build` zincirine nasil baglayacagimizi kararlastir.
- [x] npm paketi icinde `dist/frontend` ciktilarinin yer alacagini dogrula.

### Frontend Tasima

- [x] `frontend/` altinda Vite React uygulamasini olustur.
- [x] `atlas-frontend` componentlerinden yalnizca Blueprint icin gerekli parcalari uyarlayarak tasi.
- [x] `src/app/globals.css` stilini Vite tarafindaki global CSS'e tasi.
- [x] Tailwind config content path'lerini yeni dosya yapisina gore ayarla.
- [x] `@/...` import alias'ini Vite ve TypeScript tarafinda koru.
- [x] Next.js'e ozel dosyalari ve kullanimi tasima kapsamina alma.
- [x] Chat panelini, activity tab'ini ve terminal stream parsing kodunu yeni frontend'e tasima.
- [x] Layout'u chat kolonu olmadan iki ana alana gore uyumla: Explorer + ana workspace.
- [x] Yeni frontend kodunda `Atlas`, `atlas-*`, `components/atlas` ve `lib/atlas` isimlerini kullanma.

### Backend HTTP Degisiklikleri

- [x] HTTP server'in statik frontend root'unu `dist/frontend` olacak sekilde duzelt.
- [x] `/api/terminal/query` endpoint'ini kaldir.
- [x] `/api/terminal/query/stream` endpoint'ini kaldir.
- [x] Server bootstrap icindeki terminal stream ozel branch'ini kaldir.
- [x] API router'i sadece Blueprint veri endpoint'leri ve yeni Blueprint SSE endpoint'i icin sadeleştir.
- [x] `GET /api/blueprint/events` SSE endpoint'ini ekle.
- [x] Blueprint output/group doc dosya degisikliklerini izleyip SSE event'i yolla.
- [x] SSE event'ini frontend'de `EventSource` ile dinle ve overview/detail verisini yenile.

### Terminal LLM Altyapisini Kaldirma

- [x] `TerminalQueryService` kodunu kaldir.
- [x] `CodexTerminalProvider` ve `cli-providers/` kodunu kaldir.
- [x] `terminal-prompt` yardimci kodunu kaldir.
- [x] `TerminalPostCommitLlmRunner` kodunu kaldir.
- [x] `blueprint:post-commit` npm script'ini kaldir.
- [x] `src/cli/blueprint-post-commit.ts` CLI entrypoint'ini kaldir.
- [x] `src/services/post-commit/` servislerini kaldir.
- [x] Post-commit testlerini kaldir.
- [x] Terminal query ve Codex provider testlerini kaldir.

### Test ve Dogrulama

- [x] Her davranis degisikligi icin once ilgili testi yaz.
- [x] Implementasyondan once testin beklenen nedenle basarisiz oldugunu dogrula.
- [x] HTTP terminal chat testlerini kaldir veya yeni kapsama gore ayikla.
- [x] Blueprint group endpoint testlerini koru.
- [x] Blueprint SSE endpoint'i icin test ekle.
- [x] Statik dosya servisinin `index.html` ve asset'leri dogru dondurdugunu test et.
- [x] `npm run lint` calistir.
- [x] `npm run build` calistir.
- [x] Gerekirse ilgili Vitest testlerini calistir.
- [x] `npm pack --dry-run --cache /private/tmp/npm-cache-blueprint` ile paket icerigini temiz build sonrasi kontrol et.

### Dokumantasyon ve Blueprint Bakimi

- [x] README'de frontend UI calistirma/erisime dair kisa not ekle.
- [x] Docker kullanimi varsa frontend'in ayni server icinden servis edildigini belirt. Bu repoda mevcut Dockerfile/docker-compose bulunmadigi icin ek Docker dokumani gerekmiyor.
- [x] Blueprint group docs'ta HTTP server ve frontend/static servis sorumluluklarini guncelle.
- [x] Chat/terminal HTTP yuzeyi kaldirildigi icin ilgili Blueprint notlarini temizle.
- [x] Kalici dosya ekleme/silme sonrasi Blueprint refresh bakimini yap.

## Karara Baglanan Konular

- [x] Post-commit LLM runner kalmayacak; terminal LLM altyapisi tamamen kaldirilacak.
- [x] `blueprint:post-commit` komutu tamamen kaldirilacak.
- [x] Frontend icin simdilik ayri CLI komutu olmayacak.
- [x] SSE dosya izleme icin polling fallback'i eklenmeyecek. Buradaki fallback, browser SSE baglantisi koparsa belirli araliklarla `/api/blueprint/groups` tekrar cekmek anlamina geliyordu.
- [x] Frontend UI server acilinca varsayilan olarak otomatik servis edilecek.
- [x] Frontend statik servis simdilik kapatilabilir olmayacak; bu konu daha sonra tekrar degerlendirilecek.
- [x] `Atlas` eski uygulama adi olarak kalacak; yeni frontend Blueprint odakli isimlerle yazilacak.

## Acik Kararlar

- [ ] Yok.

# 2- Bilinen Blueprint Bakim Sorunu

Frontend entegrasyonu sirasinda `blueprint_refresh` ve `blueprint_group_update` araclari calistirildiginda dosya envanteri, group atamalari, unassigned dosyalar ve bos group temizligi dogru sekilde guncellendi. Ancak `blueprint/brief.md` yeniden uretildikten sonra bile bazi group summary alanlari stale kaldi.

Gozlenen stale alanlar:

- `services` summary icinde kaldirilmis `TerminalQueryService` referansi kaldi.
- `core-lib` summary icinde kaldirilmis `TerminalRunner` referansi kaldi.
- `http-server` summary icinde server icin eski/yaniltici "Express tabanli" ifadesi kaldi.

Bu sorun group Markdown dosyalarindan degil, `blueprint/blueprint-output.json` icindeki generated group metadata alanlarindan kaynaklaniyor gibi gorunuyor. Proje kurallari `blueprint-output.json` dosyasinin elle duzenlenmemesini soyledigi icin simdilik manuel mudahele yapilmadi.

Sonradan odaklanilacak isler:

- [ ] Group summary metadata'sini guncellemenin dogru/resmi yolunu netlestir.
- [ ] `blueprint_refresh` akisini stale summary alanlarini yakalayacak sekilde degerlendir.
- [ ] Gerekirse Blueprint tooling'e group metadata yenileme destegi ekle.
- [ ] Metadata duzeltildikten sonra `blueprint/brief.md` dosyasini yeniden uret.

