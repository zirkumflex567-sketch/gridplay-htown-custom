# Provider Scraper Integration Blueprint

## 1) Zielbild und Scope

Ziel ist eine belastbare, erweiterbare Provider-Integration in `gridplay-api-v2`, die URL-Typen klassifiziert, playable Streams aufloest und Playlist-vs-Video Ingest sauber trennt. Die Loesung soll die PMVHaven-Staerken aus `gridplay-api/server.js` erhalten und fuer weitere Domains aus `docs/provider.txt` skalieren.

In Scope:
- Pluggable Provider-Registry in v2.
- URL-Klassifikation: `video | playlist | profile | search | unknown`.
- Resolver-Chain fuer `mp4`, `m3u8`, `embed` mit Retry/Fallback.
- Einheitliches ingest contract fuer single video vs playlist.
- Tests (unit/fixture/integration/smoke) und observability.

Out of Scope (fuer erste Iteration):
- Vollstaendige 100% Aufloesung aller 50 Domains in einem Merge.
- UI-Redesign in `index.html`/`v2/*`.
- Breaking changes an bestehenden API-Pfaden.

## 2) Ist-Stand (relevante Dateien/Funktionen)

V1 (PMVHaven-stark):
- `gridplay-api/server.js`
  - PMVHaven URL- und Host-Validierung: `validatePmvhavenPageUrl`, `validateUpstreamMediaUrl`
  - Candidate Extraction und Ranking: `collectMediaCandidates`, `pickBestMediaUrl`, `sortMediaCandidates`
  - Playlist Parsing: `extractPlaylistItemsFromNuxt`, `collectPlaylistLinksFromHtml`, `handlePlaylist`
  - Stream Proxy inkl. M3U8 rewriting: `handleStream`
  - Endpunkte: `/health`, `/resolve`, `/playlist`, `/pawg-mix`, `/stream`
- Tests vorhanden:
  - `gridplay-api/playlist.integration.test.js`
  - `gridplay-api/pawg-mix.integration.test.js`

V2 (generisch/search):
- `gridplay-api-v2/server.js`
  - Search Aggregation: `handleSearch`
  - Generische Resolve-Extraktion: `extractMediaCandidates`, `pickBestMediaUrl`, `handleResolve`
  - Stream Proxy: `handleStream`
  - Endpunkte: `/health`, `/search`, `/resolve`, `/stream`
- `gridplay-api-v2/scrapers/factory.js`
  - Template fuer Such-Scraper: `createScraper`
- `gridplay-api-v2/scrapers/index.js`
  - Registry nur fuer Search-Sites (`all`, `byId`)
- `gridplay-api-v2/scrapers/*.js`
  - Site-spezifische Search-Muster, u.a. `pmvhaven.js`, `xvideos.js`, `xhamster.js`
- `gridplay-api-v2/package.json`
  - Minimal, aktuell ohne test scripts.

## 3) Zielarchitektur

### 3.1 Provider Registry
- Eine zentrale Registry mappt Domain -> Provider-Modul.
- Provider Interface (minimal):
  - `id`
  - `domains[]`
  - `classifyUrl(url)`
  - `resolveVideo(url, ctx)`
  - `resolvePlaylist(url, ctx)` (optional)
  - `search(query, page, ctx)` (optional)

### 3.2 Classifier
- Shared Classifier liefert:
  - `kind`: `video|playlist|profile|search|unknown`
  - `providerId`
  - `canonicalUrl`
  - `confidence` (0..1)
  - `signals[]`
- Logik: Domain Match -> Provider Rules -> Generic URL Heuristics -> Unknown.

### 3.3 Resolver Chain
- Reihenfolge:
  1. Provider-specific resolver (praezise, domain-aware)
  2. Shared generic media extraction aus HTML (regex + JSON-LD + known script patterns)
  3. Embed fallback resolver
  4. Unknown-domain fallback (best effort)
- Output-Contract pro Item:
  - `pageUrl`, `mediaUrl`, `mediaType`, `streamUrl`, `title?`, `durationSeconds?`, `source`, `resolverPath[]`

### 3.4 Fallback Chain fuer unknown domains
- Wenn kein Provider matched oder Provider fehlschlaegt:
  - Generic classifier -> `unknown`
  - Generic resolver versucht media Kandidaten
  - Falls nur embed moeglich: `mediaType=embed` + embed URL
  - Falls nichts spielbar: sauberer Fehler mit reason code + logging in `video_errors`

## 4) Proposed module/file layout unter `gridplay-api-v2`

```text
gridplay-api-v2/
  server.js
  package.json
  src/
    providers/
      index.js
      registry.js
      provider-types.js
      pmvhaven.provider.js
      xvideos.provider.js
      xhamster.provider.js
      generic.provider.js
    classifier/
      url-classifier.js
      patterns/
        common-patterns.js
        pmvhaven-patterns.js
        xvideos-patterns.js
    resolver/
      resolve-entry.js
      resolver-chain.js
      steps/
        resolve-provider.js
        resolve-generic-html.js
        resolve-embed-fallback.js
        resolve-unknown-fallback.js
      retry.js
      timeout.js
    ingest/
      ingest-router.js
      ingest-video.js
      ingest-playlist.js
      ingest-profile-search.js
    observability/
      logger.js
      video-errors-store.js
      metrics.js
    cache/
      memory-cache.js
      cache-keys.js
  test/
    unit/
      url-classifier.test.js
      resolver-chain.test.js
      retry-policy.test.js
      provider-registry.test.js
    fixtures/
      urls-classification.fixture.json
      pmvhaven-playlist.fixture.html
      xvideos-video.fixture.html
      unknown-domain.fixture.html
    integration/
      resolve.video.integration.test.js
      resolve.playlist.integration.test.js
      pmvhaven.no-regression.integration.test.js
    smoke/
      api-health.smoke.test.js
      api-resolve.smoke.test.js
```

Hinweis: Falls `src/` nicht eingefuehrt werden soll, kann dieselbe Struktur direkt unter `gridplay-api-v2/` liegen. Wichtig ist die saubere Trennung der Verantwortlichkeiten.

## 5) Provider onboarding workflow (eine neue Domain)

1. Domain priorisieren (Tier 1/2/3) und Komplexitaet schaetzen.
2. Neues Provider-Modul anlegen (`*.provider.js`) mit `domains`, `classifyUrl`, `resolveVideo` und optional `resolvePlaylist/search`.
3. Registry-Eintrag in `providers/registry.js`.
4. Classifier-Patterns ergaenzen (`classifier/patterns/*`).
5. Resolver-Chain mapping pruefen (Provider Step + Fallback Verhalten).
6. Fixtures anlegen:
   - repr. video URL
   - repr. playlist URL (falls vorhanden)
   - edge URLs (profile/search/unknown)
7. Tests schreiben:
   - unit classifier + provider
   - integration resolve
8. Lokale test runs und Report aktualisieren (`done|partial|blocked`).

## 6) Playlist-vs-Video detection strategy pro Provider-Kategorie

Kategorie A: Strukturierte Video-Portale (z.B. xvideos/xhamster/youporn)
- `video`: Pfade wie `/video`, `/watch`, `/videos/<id-or-slug>`.
- `playlist`: Pfade wie `/playlist`, `/playlists`, query Marker `list=`.
- `profile`: `/users/`, `/model/`, `/channel/`.
- `search`: query parameter (`q`, `k`, `search`) oder `/search`.

Kategorie B: PMVHaven-like mit Nuxt payload
- `playlist`: priorisiert durch Pfadregex und Payload-Signale (`__NUXT_DATA__`, state keys).
- `video`: einzelne `video/videos` Pfade.
- Bei Ambiguitaet: erst playlist parser versuchen, dann video resolver.

Kategorie C: Aggregator/Index/Blog Domains
- Oft keine direkte Medien-URL im ersten Request.
- `search/profile` kann in outbound links resultieren.
- Resolver darf Redirect-/outbound-step erlauben (begrenzt, sicher).

Kategorie D: Live/Embed-first Domains
- Primar `embed` oder HLS master playlists.
- `video` kann indirekt sein; classify confidence niedriger.
- Ausgabe bleibt spielbar via embed fallback, falls mp4/m3u8 nicht direkt verfuegbar.

## 7) Error handling, retries, caching, logging, observability

Retry/Timeout:
- Retry policy: max 3 Versuche (1 initial + 2 retries), exponential backoff (z.B. 250ms, 750ms).
- Per-step timeout (z.B. 8s search/classify fetch, 12s resolve fetch).
- Retry nur bei transient errors (5xx, network reset, timeout), nicht bei 4xx schema errors.

Fehlerobjekte:
- Normalisiertes Fehlerformat:
  - `code` (z.B. `E_PROVIDER_UNSUPPORTED`, `E_RESOLVE_EMPTY`, `E_HTTP_403`)
  - `providerId`, `url`, `step`, `attempt`, `message`, `timestamp`

Caching:
- In-memory TTL cache fuer:
  - Classifier Ergebnis (kurz, z.B. 5 min)
  - Resolve Ergebnis (kurz, z.B. 2-5 min wegen signed URLs)
  - Search snippets/Fetched HTML optional (sehr kurz)

Logging + `video_errors`:
- Fuehre strukturierte Logging-Events ein.
- Persistiere Fehlerereignisse in `video_errors` (mindestens als JSONL/Datei oder bestehendes logging sink), inkl. dedupe key.
- Keine sensiblen Daten loggen (Cookies, Tokens).

Observability:
- Counters: resolve_success, resolve_failure, classifier_unknown, provider_fallback_used.
- Timer: resolve_latency_ms per provider.
- Health endpoint um minimale metrics erweitern (ohne breaking changes).

## 8) Test strategy (unit + fixture + integration + smoke)

Unit Tests:
- `gridplay-api-v2/test/unit/url-classifier.test.js`
- `gridplay-api-v2/test/unit/provider-registry.test.js`
- `gridplay-api-v2/test/unit/resolver-chain.test.js`
- `gridplay-api-v2/test/unit/retry-policy.test.js`

Fixture Tests:
- `gridplay-api-v2/test/fixtures/urls-classification.fixture.json`
- `gridplay-api-v2/test/fixtures/pmvhaven-playlist.fixture.html`
- `gridplay-api-v2/test/fixtures/xvideos-video.fixture.html`
- `gridplay-api-v2/test/fixtures/unknown-domain.fixture.html`

Integration Tests:
- `gridplay-api-v2/test/integration/resolve.video.integration.test.js`
- `gridplay-api-v2/test/integration/resolve.playlist.integration.test.js`
- `gridplay-api-v2/test/integration/pmvhaven.no-regression.integration.test.js`

Smoke Tests:
- `gridplay-api-v2/test/smoke/api-health.smoke.test.js`
- `gridplay-api-v2/test/smoke/api-resolve.smoke.test.js`

Command Beispiele (guarded, da aktuell keine scripts in `gridplay-api-v2/package.json`):
- Primar (wenn `test` script hinzugefuegt wird):
  - `npm --prefix gridplay-api-v2 test`
- Alternative ohne scripts:
  - `node --test gridplay-api-v2/test/unit/*.test.js`
  - `node --test gridplay-api-v2/test/integration/*.test.js`
  - `node --test gridplay-api/playlist.integration.test.js gridplay-api/pawg-mix.integration.test.js`

## 9) Rollout strategy in Waves (2 Agents, low conflict)

Wave 0 (stabilisieren, 0.5 Tag)
- Agent A: Architektur-Skeleton (registry, classifier shell, resolver chain shell).
- Agent B: Test-Harness + Fixtures + baseline PMVHaven no-regression tests.
- Konfliktarm durch getrennte Verzeichnisse `src/*` vs `test/*`.

Wave 1 (Tier 1 Provider, 1-2 Tage)
- Agent A: PMVHaven + XVideos + XHamster Provider Resolver.
- Agent B: Classifier Patterns + Integration Tests fuer dieselben Provider.

Wave 2 (Tier 2 Provider, 1-2 Tage)
- Agent A: mittlere Komplexitaet Domains (search/video portals).
- Agent B: Unknown fallback, embed fallback, observability + `video_errors`.

Wave 3 (Tier 3/Blocker handling, 1 Tag)
- Agent A: schwierige/live/aggregator Domains als `partial`/`blocked` sauber markieren.
- Agent B: Dokumentation, coverage report, final regression pass.

Merge-Regeln:
- Kleine PRs pro Providergruppe.
- Gemeinsame Contracts zuerst fixieren (`provider-types.js`, response schema).
- Kein gleichzeitiges Editieren von `server.js` in grossen Blobs; adapter layer bevorzugen.

## 10) Domain Mapping aus `docs/provider.txt` nach Tier und Komplexitaet

Legende Komplexitaet: L=low, M=medium, H=high, VH=very high.

| Domain | Tier | Komplexitaet | Hinweis |
|---|---|---:|---|
| pornhub.com | 1 | H | grosse Site, anti-bot, wichtig |
| xhamster.com | 1 | M | bereits v2 search vorhanden |
| xvideos.com | 1 | M | bereits v2 search vorhanden |
| stripchat.com | 2 | VH | live/embed Fokus |
| xnxx.com | 1 | M | xvideos-nahe Muster |
| eporner.com | 1 | M | bereits v2 search vorhanden |
| chaturbate.com | 2 | VH | live/room basierte URLs |
| faphouse.com | 2 | H | auth/anti-bot moeglich |
| onlyfans.com | 3 | VH | paywall/legal hoher Aufwand |
| erome.com | 2 | H | gallery/album Schwerpunkt |
| spankbang.com | 1 | H | mehrere page patterns |
| xhamster.desi | 2 | H | mirror/domain variant |
| xhamster44.desi | 3 | H | mirror/domain variant |
| dmm.co.jp | 3 | VH | regional, komplexe flows |
| missav.ws | 2 | H | volatile domain setup |
| simpcity.cr | 3 | VH | forum/aggregator |
| stripchatgirls.com | 3 | VH | aggregator/live links |
| kemono.cr | 3 | VH | archive/creator feed |
| tnaflix.com | 1 | M | bereits v2 search vorhanden |
| noodlemagazine.com | 2 | H | embed/generic mix |
| rcdn-web.com | 3 | H | eher media host/cdn |
| ixxx.com | 2 | H | gemischte patterns |
| xvv1deos.com | 3 | H | typo/mirror domain |
| xhamsterlive.com | 2 | VH | live variant |
| pornhub.org | 3 | H | clone/mirror unklar |
| xvideos.es | 2 | M | locale variant |
| xgroovy.com | 2 | H | aggregator style |
| xham.live | 3 | VH | short live domain |
| qorno.com | 2 | M | portal, moegliche similarity |
| cityheaven.net | 3 | VH | services/listings |
| livejasmin.com | 3 | VH | live/paywall |
| xhamster1.desi | 3 | H | mirror variant |
| youporn.com | 1 | M | bereits v2 search vorhanden |
| newtoki469.com | 3 | VH | nicht klar video-first |
| xnxx.es | 2 | M | locale variant |
| faphouse2.com | 3 | H | clone variant |
| xhaccess.com | 3 | VH | redirect/landing risk |
| rule34.xxx | 2 | H | mixed media pages |
| xhamster19.com | 3 | H | mirror variant |
| v2006.com | 3 | VH | unklare Sitefunktion |
| rm358.com | 3 | VH | unklare Sitefunktion |
| njavtv.com | 2 | H | regional aggregator |
| xnxx.tv | 2 | M | xnxx variant |
| clickadu.net | 3 | VH | ad network, kein content provider |
| purplesacam.com | 3 | VH | unklare Sitefunktion |
| goldensacam.com | 3 | VH | unklare Sitefunktion |
| missav.ai | 2 | H | missav variant |
| theporndude.com | 3 | VH | link directory |
| pornpics.com | 2 | H | image-first, video selten |
| desitales2.com | 3 | VH | blog/aggregator moeglich |

Empfohlener Startumfang fuer erste produktive Welle:
- Tier 1 komplett + Tier 2 nur die technisch naheliegenden Domains.

## 11) Open risks / legal / compliance notes

- Einige Domains koennen Terms/robots/copyright-relevante Einschraenkungen haben.
- Paywall-/auth-lastige Plattformen (z.B. onlyfans) nicht als Schnellgewinn planen.
- Regionale Mirrors und volatile Domains koennen haeufig brechen; robustes fallback + status reporting noetig.
- Logging muss datensparsam sein (keine PII, keine auth header, keine cookies).
- Bei unklarer Rechtslage Provider als `blocked` markieren statt aggressive Umgehung zu implementieren.

## 12) Definition of done

Eine Integration gilt als abgeschlossen, wenn alle Punkte erfuellt sind:
- Architektur live: Provider Registry + Classifier + Resolver Chain aktiv in `gridplay-api-v2`.
- Klassifikation liefert alle 5 Typen und erreicht Zielqualitaet (>=95% auf Fixture-Set).
- Playlist-vs-Video Ingest verhaelt sich deterministisch und ist API-seitig klar signalisiert.
- PMVHaven no-regression ist nachweisbar (bestehende Flows + Tests gruen).
- Test-Suite gruen (unit/fixture/integration/smoke) mit dokumentierter Testevidenz.
- `video_errors` logging und Basis-Metriken vorhanden.
- Domain-Statusreport fuer alle 50 Domains (`done|partial|blocked`) liegt vor.
- Keine breaking changes an bestehenden Endpunkten, v1/v2 Rueckwaertskompatibilitaet bleibt erhalten.
