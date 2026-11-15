// Läuft im Hintergrund-Thread, damit die Oberfläche während der Analyse flüssig bleibt.
import { analyzeSamples } from './beats';

self.onmessage = (e: MessageEvent<Float32Array>) => {
  (self as unknown as Worker).postMessage(analyzeSamples(e.data));
};
