// Mediathek: Ordner mit Fotos/Videos aus der Dateien-App, Musik, Speicherplatz.
// Ersetzt die Alben der Fotomediathek aus der iOS-App.
import { useEffect, useState } from 'preact/hooks';
import {
  createFolder, deleteFolder, deleteSong, folderItems, folders, importIntoFolder, importSongs, importState,
  removeFromFolder, renameFolder, songs, type Folder, type MediaItem,
} from '../media/library';
import { requestPersistence, storageEstimate } from '../model/db';
import { Card, Icon, Note, Sheet, Thumb, askName, canPickDirectory, formatTime, pickFiles, showToast } from './components';

const MEDIA_ACCEPT = 'video/*,image/*,.mov,.mp4,.m4v,.heic,.heif,.jpg,.jpeg,.png,.bmp,.webp,.gif,.tif,.tiff';
const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.aif,.aiff';

export function ImportProgress() {
  const s = importState.value;
  if (!s) return null;
  return (
    <Card>
      <div class="row"><span>{s.label} … {s.done} / {s.total}</span></div>
      <div class="progress"><div style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%` }} /></div>
      <Note>Die Dateien werden in den Speicher der App kopiert. Bitte die Seite geöffnet lassen.</Note>
    </Card>
  );
}

/** Dateien wählen und in einen Ordner importieren (mit Rückmeldung). */
export async function importMediaInto(folderId: string, directory = false) {
  const files = await pickFiles({ accept: directory ? undefined : MEDIA_ACCEPT, multiple: true, directory });
  if (!files.length) return 0;
  void requestPersistence();
  const r = await importIntoFolder(folderId, files);
  const parts = [`${r.added} hinzugefügt`];
  if (r.skipped) parts.push(`${r.skipped} übersprungen`);
  if (r.failed.length) parts.push(`${r.failed.length} nicht lesbar`);
  showToast(parts.join(' · '));
  return r.added;
}

export async function importMusic() {
  const files = await pickFiles({ accept: AUDIO_ACCEPT, multiple: true });
  if (!files.length) return;
  void requestPersistence();
  const r = await importSongs(files);
  showToast(r.failed.length ? `${r.added} Songs importiert, ${r.failed.length} nicht lesbar` : `${r.added} Songs importiert`);
}

export async function newFolderWithImport(): Promise<Folder | null> {
  const name = await askName('Name des neuen Ordners (z. B. „Kreta 2026“)');
  if (!name) return null;
  const f = await createFolder(name);
  await importMediaInto(f.id);
  return f;
}

export function FolderRow({ folder, onClick }: { folder: Folder; onClick: () => void }) {
  const items = folderItems(folder.id);
  const videos = items.filter((i) => !i.isPhoto).length;
  return (
    <button class="item" onClick={onClick}>
      <Thumb id={items[0]?.id} size={56} />
      <div class="meta">
        <div class="title">{folder.name}</div>
        <div class="sub">{items.length} Objekte · {videos} Videos · {items.length - videos} Fotos</div>
      </div>
      <span class="chev"><Icon name="chevron" size={18} /></span>
    </button>
  );
}

export function LibraryScreen({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { void storageEstimate().then(setUsage); }, [folders.value, songs.value]);
  const folder = folders.value.find((f) => f.id === open);

  return (
    <>
      <div class="topbar">
        <button class="iconbtn" onClick={onBack}><Icon name="back" /> Reels</button>
        <h1>Mediathek</h1>
        <span style="min-width:70px" />
      </div>
      <div class="scroll stack">
        <ImportProgress />
        <Card title="Ordner mit Fotos & Videos">
          <Note>Lege für jeden Urlaub einen Ordner an. Beim Import öffnest du in der Dateien-App deinen Ordner, tippst oben rechts auf „Auswählen“ → „Alle auswählen“ und dann auf „Öffnen“.</Note>
          {folders.value.length > 0 && (
            <div class="list">
              {folders.value.map((f) => <FolderRow key={f.id} folder={f} onClick={() => setOpen(f.id)} />)}
            </div>
          )}
          <button class="btn primary block" onClick={() => void newFolderWithImport()}><Icon name="plus" /> Neuer Ordner …</button>
        </Card>

        <Card title="Musik">
          {songs.value.length === 0 && <Note>Noch keine Musik. Wähle deine MP3s in der Dateien-App aus.</Note>}
          {songs.value.length > 0 && (
            <div class="list">
              {songs.value.map((s) => (
                <div class="item" key={s.id}>
                  <Icon name="music" size={20} />
                  <div class="meta"><div class="title">{s.name}</div><div class="sub">{formatTime(s.duration)}</div></div>
                  <button class="iconbtn" aria-label="Löschen" onClick={() => { if (confirm(`„${s.name}“ aus der App löschen?`)) void deleteSong(s.id); }}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button class="btn tint" onClick={() => void importMusic()}><Icon name="plus" /> Musik hinzufügen …</button>
        </Card>

        {usage && (
          <Card title="Speicher">
            <Note>Belegt: {(usage.used / 1e9).toFixed(2).replace('.', ',')} GB von ca. {(usage.quota / 1e9).toFixed(0)} GB, die der Browser dieser App erlaubt.</Note>
            <Note>Tipp: Füge die App über „Teilen → Zum Home-Bildschirm“ hinzu. Dann löscht Safari die Daten nicht automatisch.</Note>
          </Card>
        )}
      </div>
      {folder && <FolderSheet folder={folder} onClose={() => setOpen(null)} />}
    </>
  );
}

function FolderSheet({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const items = folderItems(folder.id);
  const [editing, setEditing] = useState(false);
  return (
    <Sheet title={folder.name} onClose={onClose} left={<button class="iconbtn" onClick={onClose}>Fertig</button>}
      right={<button class="iconbtn" onClick={() => setEditing(!editing)}>{editing ? 'Fertig' : 'Bearbeiten'}</button>}>
      <div class="scroll stack">
        <ImportProgress />
        <div class="row wrap">
          <button class="btn primary" onClick={() => void importMediaInto(folder.id)}><Icon name="plus" /> Dateien hinzufügen</button>
          {canPickDirectory && <button class="btn" onClick={() => void importMediaInto(folder.id, true)}><Icon name="folder" /> Ganzen Ordner</button>}
        </div>
        {editing && (
          <div class="row wrap">
            <button class="btn" onClick={async () => { const n = await askName('Ordner umbenennen', folder.name); if (n) { await renameFolder(folder.id, n); showToast(`Umbenannt in „${n}“`); } }}>Umbenennen</button>
            <button class="btn danger" onClick={() => { if (confirm(`Ordner „${folder.name}“ mit allen ${items.length} Dateien aus der App löschen? Die Originale in der Dateien-App bleiben erhalten.`)) { void deleteFolder(folder.id); onClose(); } }}>Ordner löschen</button>
          </div>
        )}
        {items.length === 0 ? <Note>Dieser Ordner ist noch leer.</Note> : (
          <div class="media-grid">
            {items.map((m: MediaItem) => (
              <button key={m.id} onClick={() => { if (editing && confirm(`„${m.name}“ entfernen?`)) void removeFromFolder(folder.id, m.id); }}>
                <Thumb id={m.id} showDuration />
              </button>
            ))}
          </div>
        )}
        {editing && items.length > 0 && <Note>Tippe auf ein Bild, um es aus dem Ordner zu entfernen.</Note>}
      </div>
    </Sheet>
  );
}

/** Ordner für einen Reel-Bereich wählen (wie AlbumPickerSheet). */
export function FolderPickerSheet({ title, onPick, onClose }: { title: string; onPick: (f: Folder) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div class="scroll stack">
        <ImportProgress />
        {folders.value.length > 0 ? (
          <div class="list">
            {folders.value.map((f) => <FolderRow key={f.id} folder={f} onClick={() => { onPick(f); onClose(); }} />)}
          </div>
        ) : <Note>Noch keine Ordner. Lege einen an und wähle die Fotos und Videos deines Urlaubs aus der Dateien-App.</Note>}
        <button class="btn primary block" onClick={async () => {
          const f = await newFolderWithImport();
          if (f && folderItems(f.id).length) { onPick(f); onClose(); }
        }}><Icon name="plus" /> Neuer Ordner aus der Dateien-App …</button>
      </div>
    </Sheet>
  );
}

/** Einzelne oder mehrere Fotos/Videos aus einem Ordner wählen (wie AssetPickerSheet). */
export function AssetPickerSheet({ kind, multiple, onPick, onClose }: {
  kind: 'photo' | 'video' | 'both'; multiple?: boolean; onPick: (items: MediaItem[]) => void; onClose: () => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const folder = folders.value.find((f) => f.id === folderId);
  const items = folderId ? folderItems(folderId).filter((m) => kind === 'both' || (kind === 'photo') === m.isPhoto) : [];
  const title = folder ? folder.name : kind === 'photo' ? 'Foto wählen' : kind === 'video' ? 'Video wählen' : 'Medien wählen';
  return (
    <Sheet title={title} onClose={onClose}
      left={folder ? <button class="iconbtn" onClick={() => { setFolderId(null); setSelected([]); }}><Icon name="back" /> Ordner</button> : undefined}
      right={multiple && folder ? (
        <button class="iconbtn" disabled={!selected.length} onClick={() => {
          onPick(selected.map((id) => items.find((m) => m.id === id)!).filter(Boolean));
          onClose();
        }}>Hinzufügen ({selected.length})</button>
      ) : undefined}>
      <div class="scroll stack">
        <ImportProgress />
        {!folder && (
          <>
            {folders.value.length > 0 && (
              <div class="list">{folders.value.map((f) => <FolderRow key={f.id} folder={f} onClick={() => setFolderId(f.id)} />)}</div>
            )}
            <button class="btn tint" onClick={async () => { const f = await newFolderWithImport(); if (f) setFolderId(f.id); }}>
              <Icon name="plus" /> Neuer Ordner aus der Dateien-App …
            </button>
          </>
        )}
        {folder && (
          <>
            <button class="btn small" onClick={() => void importMediaInto(folder.id)}><Icon name="plus" /> Dateien hinzufügen</button>
            {items.length === 0 && <Note>Keine passenden Dateien in diesem Ordner.</Note>}
            <div class="media-grid">
              {items.map((m) => {
                const n = selected.indexOf(m.id);
                return (
                  <button key={m.id} class={n >= 0 ? 'sel' : ''} onClick={() => {
                    if (!multiple) { onPick([m]); onClose(); return; }
                    setSelected(n >= 0 ? selected.filter((x) => x !== m.id) : [...selected, m.id]);
                  }}>
                    <Thumb id={m.id} showDuration number={n >= 0 ? n + 1 : undefined} />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
