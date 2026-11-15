// App-Rahmen: einfache Navigation über den URL-Hash (Zurück-Geste funktioniert).
import { useEffect, useState } from 'preact/hooks';
import { projects } from '../model/store';
import { toast } from './components';
import { EditorView } from './editor';
import { LibraryScreen } from './library';
import { ProjectList } from './projects';

type Route = { screen: 'list' } | { screen: 'library' } | { screen: 'editor'; id: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'mediathek') return { screen: 'library' };
  if (h.startsWith('reel/')) return { screen: 'editor', id: h.slice(5) };
  return { screen: 'list' };
}

export function App() {
  const [route, setRoute] = useState<Route>(parse());
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (h: string) => { location.hash = h; };
  const back = () => { if (history.length > 1 && location.hash) history.back(); else go(''); };

  let content;
  if (route.screen === 'editor') {
    const p = projects.value.find((x) => x.id === route.id);
    content = p ? <EditorView key={p.id} project={p} onBack={() => go('')} /> : <ProjectList onOpen={(id) => go('reel/' + id)} onLibrary={() => go('mediathek')} />;
  } else if (route.screen === 'library') {
    content = <LibraryScreen onBack={back} />;
  } else {
    content = <ProjectList onOpen={(id) => go('reel/' + id)} onLibrary={() => go('mediathek')} />;
  }
  return (
    <>
      {content}
      {toast.value && <div class="toast">{toast.value}</div>}
    </>
  );
}
