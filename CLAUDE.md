# Reel Studio (Web)

Web-App (PWA) fürs iPhone, Nachfolger der iOS-App in `../Reel Studio iOS`. Gleicher Funktionsumfang (Version 1), aber Medien kommen aus der **Dateien-App** statt aus der Fotomediathek. Die Oberfläche ist komplett auf Deutsch. Der Nutzer ist kein Entwickler: Erklärungen bitte einfach und auf Deutsch.

## Technik
- Vite + TypeScript + Preact (+ @preact/signals). Video: **mediabunny** (Demux/Decode/Encode/MP4 über WebCodecs). Bild: WebGL2. Ton: Web Audio (OfflineAudioContext).
- Alles läuft im Browser; keine Server. Veröffentlicht über GitHub Pages: `npm run deploy` (`scripts/deploy.sh`) baut mit `BASE_PATH=/<repo>/` und schiebt `dist/` auf den Branch `gh-pages`. Repo: github.com/limo751/reel-studio (öffentlich). Der gh-Login hat keinen `workflow`-Scope, deshalb keine GitHub Actions.
- Daten in IndexedDB (`src/model/db.ts`): Projekte, Medien-Metadaten, Dateiinhalte (Blobs), Analysen, Vorschaubilder.

## Aufbau (Swift-Vorlage in Klammern)
- `src/model/project.ts` (Project.swift), `editor.ts` (EditorModel), `store.ts` (ProjectStore)
- `src/media/library.ts` (PhotoLibrary/MusicLibrary → Ordner, Musik, LUTs), `metadata.ts` (EXIF/QuickTime-Datum & GPS)
- `src/media/image.ts`: Bilder robust dekodieren (createImageBitmap, sonst über <img> + Leinwand) – JPG, PNG, BMP, HEIC …
- `src/engine/ramp.ts`: Tempo-Rampe pro Reel-Clip (`speed` 1–10, `rampIn`/`rampOut` in s, Smoothstep). Reicht das Material nicht, senkt `fitRamp` das Höchsttempo. Beschleunigte Clips ohne Originalton.
- `src/engine/beats.ts` (BeatAnalyzer, gleiche Parameter), `planner.ts` (Planner), `timeline.ts` (CompositionBuilder → RenderPlan), `audio.ts` (Mischung inkl. Ducking, Begrenzer)
- `src/engine/gl/*` (Compositor + Looks als Shader: Fit/Crop/Ken Burns, 15 Übergänge, Grading, Presets, LUTs, Auto-Korrektur)
- `src/engine/frames.ts` + `exporter.ts` (frame-genauer Export, H.264 11 Mbit/s, AAC 256k), `preview.ts` (Live-Vorschau mit Video-Elementen; Ton vorab gemischt)
- `src/ui/*` Tabs Bereiche/Musik/Titel/Look/Layout/Export, Mediathek, Bildausschnitt

## Bauen & Testen
- `npm run dev` (Port 5174), `npm test` (Vitest: Beat-Analyse, Planer, Layout), `npm run typecheck`, `npm run build`
- Testmedien liegen lokal in `test-media/` (nicht im Git). Im Dev-Modus gibt es `window.__reel = { lib, store }` zum Import ohne Datei-Dialog.

## Bekannte Eigenheiten
- Namen werden über `askName()` (eigener Dialog) abgefragt, nicht über `window.prompt` – das ist in der Home-Bildschirm-App unzuverlässig.
- iPhone-Safari kann keinen ganzen Ordner wählen → Mehrfachauswahl in der Dateien-App. Auf dem Desktop gibt es zusätzlich „Ganzen Ordner“.
- Export nur im Vordergrund (Wake Lock hält den Bildschirm an). Kein Hintergrund-Export wie in der App.
- Videoframes werden über `VideoSample.drawWithFit` auf eine 2D-Leinwand gezeichnet (wendet die Drehung an), dann als Textur hochgeladen.
- Ohne „Zum Home-Bildschirm“ darf Safari die Daten nach längerer Nichtnutzung löschen.
