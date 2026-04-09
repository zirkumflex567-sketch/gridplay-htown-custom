Kontext: Dieser Prompt delegiert die Implementierung einer robusten Provider-Scraping- und Link-Resolution-Architektur an einen separaten AI-Engineer fuer `gridplay-api-v2`, bei gleichzeitiger Wahrung der bestehenden PMVHaven-Staerken und API-Kompatibilitaet.

```text
Du arbeitest in einem bestehenden Node.js-Repo mit den Schwerpunkten `gridplay-api` (v1, PMVHaven-stark) und `gridplay-api-v2` (generische/search-basierte Scraper). Implementiere eine erweiterbare Provider-Architektur fuer URL-Klassifikation, Stream-Resolution und ingest-Logik (Single Video vs Playlist), ohne bestehende Endpunkte zu brechen.

Ziele
1) Provider-Skripte/Module in pluggable Architektur aufbauen.
2) URL-Klassifikation implementieren: `video | playlist | profile | search | unknown`.
3) Playable Stream-Aufloesung (mp4/m3u8/embed) mit Retry- und Fallback-Kette liefern.
4) Unterschiedliches Ingest-Verhalten fuer Playlist vs Single Video in App/Backend definieren und integrieren.
5) PMVHaven-Staerken aus v1 beibehalten (Resolver-Qualitaet, Playlist-Extraktion, stabile Stream-Proxy-Pfade).
6) Tests bauen/erweitern und ausfuehren.
7) Implementierungsreport ausgeben (geaenderte Dateien, Testergebnisse, offene Provider).

Pflichtkontext aus Codebasis
- v1 PMVHaven-Schwerpunkt: `gridplay-api/server.js`
- v2 API und Scraper-Einstieg: `gridplay-api-v2/server.js`, `gridplay-api-v2/scrapers/index.js`, `gridplay-api-v2/scrapers/factory.js`
- Providerliste (Must-have Domains): `docs/provider.txt`

Umsetzungsanforderungen
A) Architektur
- Fuehre in `gridplay-api-v2` eine Provider-Registry ein, die Domain -> Provider-Modul mappt.
- Jeder Provider kapselt mindestens:
  - `id`, `domains`, `classifyUrl(url)`, `resolve(input, ctx)`, optional `search(query, page, ctx)`.
- Baue eine globale Resolver-Chain:
  1. Provider-spezifischer Resolver,
  2. Shared HTML-Media-Extractor,
  3. Embed-Fallback,
  4. Unknown-Domain-Fallback.

B) Klassifikation
- Implementiere robusten Classifier mit Ergebnisobjekt:
  `{ kind, providerId, canonicalUrl, confidence, signals[] }`.
- `kind` ist exakt eines von `video|playlist|profile|search|unknown`.
- Nutze host + path + query + bekannte Muster pro Provider.
- Liefere bei Ambiguitaet `unknown` mit sinnvollen Signals statt hartem Fehler.

C) Resolution
- Zielausgabe je resolved Item:
  `{ pageUrl, mediaUrl, mediaType, streamUrl, title?, durationSeconds?, source, resolverPath[] }`
- `mediaType` priorisieren: mp4 > m3u8 > embed.
- Implementiere Retries mit Backoff (mindestens 2 Retries pro Upstream-Schritt) und Timeout-Handling.
- Fallbacks bei HTTP-Fehlern/Parsing-Fehlern aktivieren, inklusive unknown-domain generic extraction.

D) Playlist vs Single Video Ingest
- Definiere klaren ingest branch:
  - `video`: genau ein resolved Item liefern.
  - `playlist`: geordnete Liste von Items liefern, Teilauflosung erlaubt (partially resolved).
  - `profile/search`: Liste von Kandidaten + optional eager resolve bis konfigurierbares Limit.
- Stelle sicher, dass Backend-Response eindeutig signalisiert, ob Einzelvideo oder Liste geliefert wurde.

E) PMVHaven-Kompatibilitaet
- V1-Staerken nicht abbauen. Wenn Logik in v2 uebernommen wird, dann funktionsgleich oder robuster.
- Keine Regression bei PMVHaven-Playlist-Erkennung und PMVHaven-Media-Resolution.

F) API- und Migrationsregeln
- Bestehende Endpunkte nicht brechen.
- v1/v2 Pfade rueckwaertskompatibel halten.
- Falls neue Endpunkte eingefuehrt werden, alte weiter bedienen und Verhalten dokumentieren.

G) Tests und Qualitaet
- Erweitere Test-Suite mit Unit-, Fixture- und Integrations-Tests.
- Fuehre Tests lokal aus und dokumentiere die konkreten Kommandos + Resultate.
- Mindestens abdecken:
  - Klassifikation (alle 5 Klassen),
  - PMVHaven no-regression,
  - mind. ein Tier-1 Provider je Klasse von URL-Mustern,
  - Retry/Fallback-Verhalten.

H) Sicherheits-/Betriebsgrenzen
- Keine destruktiven Git-Befehle (kein reset --hard, kein checkout --, kein force push).
- Keine Secrets committen.
- Keine bestehenden Endpunkte entfernen oder semantisch brechen.
- Rueckwaertskompatibilitaet fuer v1/v2 zwingend.

Akzeptanzkriterien (Definition of Success)
1) Provider-Coverage-Prozess:
   - Es existiert ein klarer, wiederholbarer Onboarding-Workflow pro Domain (Registry + Classifier + Resolver + Tests).
   - Domains aus `docs/provider.txt` sind in Prioritaets-Tiers eingeordnet und mindestens Tier-1 initial integriert oder mit blocker-begruendung dokumentiert.
2) Classifier-Qualitaet:
   - Zielwert >= 95% korrekte Klassifikation auf dem bereitgestellten Fixture-Set.
   - Keine harte Failure bei unbekannten URLs; stattdessen `unknown` mit Signals.
3) PMVHaven no regression:
   - Bestehende PMVHaven-Flows funktionieren weiterhin (Resolve + Playlist).
   - Relevante Bestands-Tests bleiben gruen.
4) Test-Suite gruen:
   - Alle vorhandenen + neuen Tests erfolgreich.
   - Testevidenz im Report enthalten (Befehle, Exit Codes, Kernausgaben).
5) Betriebsstabilitaet:
   - Retry/Fallback aktiv, Fehlerpfade geloggt, und keine API-Backward-Compatibility-Brueche.

Lieferformat (zwingend)
Am Ende einen Implementierungsreport in Markdown liefern mit:
- Kurzuebersicht der Architekturentscheidungen.
- Liste aller geaenderten/neu angelegten Dateien.
- Testevidenz (ausgefuehrte Kommandos, Ergebnisse, relevante Ausschnitte).
- Tabelle: Provider-Status pro Domain (`done | partial | blocked`) mit kurzer Begruendung.
- Offene Punkte/Rest-Risiken und empfohlene naechste Schritte.
``` 
