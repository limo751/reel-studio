// Editor-Zustand – entspricht Model/EditorModel.swift (ohne Player; die Vorschau liegt in engine/preview.ts).
import { computed, signal } from '@preact/signals';
import { BeatGrid, type BeatAnalysis } from '../engine/beats';
import { analyzeSong } from '../engine/music';
import { newClip, planReel as plan } from '../engine/planner';
import { reelDuration } from '../engine/timeline';
import { folderItems, folders, songs, type MediaItem } from '../media/library';
import { clone, type Project } from './project';
import { saveProject } from './store';

export class Editor {
  readonly project = signal<Project>(null as unknown as Project);
  readonly analysis = signal<BeatAnalysis | null>(null);
  readonly analyzing = signal(false);
  readonly selectedArea = signal(0);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  didPromptAlbum = false;

  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastSnapshot = 0;
  private saveTimer = 0;

  readonly song = computed(() => songs.value.find((s) => s.id === this.project.value.music.song) ?? null);
  readonly grid = computed(() => new BeatGrid(this.song.value ? this.analysis.value : null, this.project.value.music.start));
  readonly duration = computed(() => reelDuration(this.project.value, this.song.value ? this.analysis.value : null));

  constructor(p: Project) {
    this.project.value = clone(p);
    void this.loadAnalysis();
  }

  /** Projekt ändern (mit Rückgängig-Schritt und automatischem Speichern). */
  update(mutate: (p: Project) => void) {
    const old = this.project.value;
    const next = clone(old);
    mutate(next);
    if (JSON.stringify(next) === JSON.stringify(old)) return;
    if (Date.now() - this.lastSnapshot > 800) {
      this.undoStack.push(old);
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastSnapshot = Date.now();
    this.apply(next, old);
  }

  private apply(next: Project, old: Project) {
    this.project.value = next;
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
    if (old.music.song !== next.music.song) void this.loadAnalysis();
    this.scheduleSave();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.project.value);
    this.lastSnapshot = 0;
    this.apply(prev, this.project.value);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project.value);
    this.lastSnapshot = 0;
    this.apply(next, this.project.value);
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void saveProject(this.project.value), 800);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    return saveProject(this.project.value);
  }

  // MARK: Musik

  async loadAnalysis() {
    const id = this.project.value.music.song;
    if (!id) { this.analysis.value = null; return; }
    this.analyzing.value = true;
    try {
      const a = await analyzeSong(id);
      if (this.project.value.music.song === id) this.analysis.value = a;
    } catch (e) {
      console.warn('Analyse fehlgeschlagen', e);
      this.analysis.value = null;
    } finally {
      this.analyzing.value = false;
    }
  }

  /** Startpunkt im Song setzen (rastet auf den nächsten Beat ein). */
  setMusicStart(t: number) {
    const a = this.analysis.value;
    const nearest = a && a.beats.length ? a.beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best)) : t;
    this.update((p) => { p.music.start = Math.max(0, nearest); });
  }

  // MARK: Reel-Planung

  planReel(areaIndex: number, folderId: string) {
    const f = folders.value.find((x) => x.id === folderId);
    const media = folderItems(folderId).map(info);
    const target = this.duration.value;
    this.update((p) => {
      const reel = p.areas[areaIndex].reel;
      reel.albumID = folderId;
      reel.albumName = f?.name ?? '';
      reel.clips = plan(media, this.grid.value, target, reel.rhythm, reel.offsetBeats, reel.defaultTransition);
    });
  }

  replanReel(areaIndex: number) {
    const id = this.project.value.areas[areaIndex].reel.albumID;
    if (id) this.planReel(areaIndex, id);
  }

  addClips(areaIndex: number, items: MediaItem[]) {
    const g = this.grid.value;
    this.update((p) => {
      const reel = p.areas[areaIndex].reel;
      const n = reel.rhythm > 0 ? reel.rhythm : g.autoBeatsPerClip;
      for (const m of items) {
        const start = m.isPhoto ? 0 : Math.max(0, (m.duration - n * g.period) / 2);
        reel.clips.push(newClip(info(m), start, n, reel.defaultTransition));
      }
    });
  }

  /** Länge des Reels in Beats vs. Länge der Clip-Liste. */
  reelCoverage(areaIndex: number) {
    const reel = this.project.value.areas[areaIndex].reel;
    const beats = reel.clips.reduce((s, c) => s + c.beats, 0) + reel.offsetBeats;
    return { used: this.grid.value.time(beats), total: this.duration.value };
  }
}

const info = (m: MediaItem) => ({ id: m.id, isPhoto: m.isPhoto, duration: m.duration, created: m.created });
