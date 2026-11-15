// Projektliste und „Neues Reel“ – entspricht UI/ProjectListView.swift.
import { useState } from 'preact/hooks';
import { songs } from '../media/library';
import { DURATIONS, FORMAT_LABEL, newProject, type AspectFormat, type Project } from '../model/project';
import { deleteProject, duplicateProject, projects, saveProject } from '../model/store';
import { Card, Icon, LayoutGlyph, Note, Seg, Select, Sheet } from './components';
import { importMusic } from './library';

export function ProjectList({ onOpen, onLibrary }: { onOpen: (id: string) => void; onLibrary: () => void }) {
  const [showNew, setShowNew] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const list = projects.value;
  return (
    <>
      <div class="topbar">
        <h1 class="big">Reel Studio</h1>
        <button class="iconbtn" onClick={onLibrary} aria-label="Mediathek"><Icon name="folder" /></button>
        <button class="iconbtn" onClick={() => setShowNew(true)} aria-label="Neues Reel"><Icon name="plus" /></button>
      </div>
      <div class="scroll">
        {list.length === 0 ? (
          <div class="empty">
            <div class="logo"><Icon name="play" /></div>
            <h2 style="margin:0">Noch keine Reels</h2>
            <p class="note" style="font-size:15px">Erstelle dein erstes Reel aus einem Ordner mit Fotos und Videos aus der Dateien-App.</p>
            <button class="btn primary" onClick={() => setShowNew(true)}><Icon name="plus" /> Neues Reel</button>
            <button class="linkbtn" onClick={onLibrary}>Mediathek öffnen</button>
          </div>
        ) : (
          <div class="list">
            {list.map((p) => (
              <div key={p.id}>
                <div class="item">
                  <button class="row" style="flex:1;background:none;border:0;padding:0;text-align:left;min-width:0" onClick={() => onOpen(p.id)}>
                    <LayoutGlyph format={p.format} count={p.areas.length} weights={p.weights} height={46} />
                    <div class="meta">
                      <div class="title">{p.title}</div>
                      <div class="sub">{p.targetDuration} s · {p.format === 'portrait' ? '9:16' : '16:9'} · {p.areas.length === 1 ? 'Vollbild' : `${p.areas.length} Bereiche`}</div>
                      <div class="sub" style="opacity:0.7">{new Date(p.modified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                    </div>
                  </button>
                  <button class="iconbtn" aria-label="Mehr" onClick={() => setMenu(menu === p.id ? null : p.id)}><Icon name="more" /></button>
                </div>
                {menu === p.id && (
                  <div class="row" style="padding:0 14px 12px;justify-content:flex-end">
                    <button class="btn small" onClick={() => { void duplicateProject(p); setMenu(null); }}>Duplizieren</button>
                    <button class="btn small danger" onClick={() => { if (confirm(`„${p.title}“ löschen?`)) void deleteProject(p.id); setMenu(null); }}>Löschen</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {showNew && (
        <NewProjectSheet onClose={() => setShowNew(false)} onCreate={async (p) => {
          await saveProject(p);
          setShowNew(false);
          onOpen(p.id);
        }} />
      )}
    </>
  );
}

function NewProjectSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Project) => void }) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(30);
  const [format, setFormat] = useState<AspectFormat>('portrait');
  const [areas, setAreas] = useState(1);
  const [song, setSong] = useState<string>(songs.value[0]?.id ?? '');
  return (
    <Sheet title="Neues Reel" onClose={onClose} right={
      <button class="iconbtn" style="font-weight:700" onClick={() => {
        const p = newProject(title.trim() || 'Mein Reel', duration, format, areas);
        p.music.song = song || null;
        onCreate(p);
      }}>Erstellen</button>
    }>
      <div class="scroll stack">
        <Card title="Titel des Reels">
          <input type="text" placeholder="z. B. Mallorca Sommer 2026" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </Card>
        <Card title="Dauer">
          <Seg options={DURATIONS.map((d) => [d, `${d} s`] as [number, string])} value={duration} onChange={setDuration} />
        </Card>
        <Card title="Format">
          <Seg options={(['portrait', 'landscape'] as AspectFormat[]).map((f) => [f, FORMAT_LABEL[f]] as [AspectFormat, string])} value={format} onChange={setFormat} />
        </Card>
        <Card title="Vorlage">
          <div class="layouts">
            {[1, 2, 3].map((n) => (
              <button key={n} class={areas === n ? 'on' : ''} onClick={() => setAreas(n)}>
                <LayoutGlyph format={format} count={n} height={70} />
                {n === 1 ? 'Vollbild' : `${n} Bereiche`}
              </button>
            ))}
          </div>
          <Note>Jeden Bereich kannst du danach einzeln mit einem Reel, einem Video, einem Foto oder einer Farbe füllen.</Note>
        </Card>
        <Card title="Musik">
          {songs.value.length === 0 ? (
            <>
              <button class="btn tint" onClick={async () => { await importMusic(); setSong(songs.value[0]?.id ?? ''); }}><Icon name="music" /> Musik auswählen …</button>
              <Note>Wähle deine MP3s in der Dateien-App. Du kannst Musik auch später hinzufügen.</Note>
            </>
          ) : (
            <Select label="Song" value={song} onChange={setSong}
              options={[['', 'Keine Musik'], ...songs.value.map((s) => [s.id, s.name] as [string, string])]} />
          )}
        </Card>
      </div>
    </Sheet>
  );
}
