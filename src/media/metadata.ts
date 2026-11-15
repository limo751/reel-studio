// Aufnahmedatum und Ort aus Foto-/Videodateien lesen (EXIF bzw. QuickTime-Metadaten).
// Bewusst klein gehalten: Es wird nur der Anfang (und bei Videos das Ende) der Datei durchsucht.

export interface CaptureInfo { date: number | null; lat: number | null; lon: number | null }

const HEAD = 512 * 1024;
const TAIL = 512 * 1024;

export async function readCaptureInfo(file: Blob, isPhoto: boolean): Promise<CaptureInfo> {
  const head = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
  if (isPhoto) {
    const exif = parseExif(head);
    if (exif) return exif;
    return { date: null, lat: null, lon: null };
  }
  // Videos (iPhone): QuickTime-Metadaten liegen im moov-Atom – am Anfang oder am Ende der Datei.
  const tail = file.size > HEAD ? new Uint8Array(await file.slice(Math.max(HEAD, file.size - TAIL)).arrayBuffer()) : new Uint8Array();
  return parseQuickTime(head) ?? parseQuickTime(tail) ?? { date: null, lat: null, lon: null };
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

function parseQuickTime(b: Uint8Array): CaptureInfo | null {
  if (!b.length) return null;
  const s = latin1(b);
  let date: number | null = null;
  // com.apple.quicktime.creationdate: "2024-07-14T18:22:05+0200"
  const d = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}:?\d{2}|Z)?/.exec(s);
  if (d) {
    const tz = d[2] ? (d[2] === 'Z' ? 'Z' : d[2].length === 5 ? d[2].slice(0, 3) + ':' + d[2].slice(3) : d[2]) : '';
    const t = Date.parse(d[1] + tz);
    if (!Number.isNaN(t)) date = t;
  }
  let lat: number | null = null;
  let lon: number | null = null;
  // ISO 6709, z. B. "+35.3387+025.1442+012.000/"
  const g = /([+-]\d{1,2}\.\d+)([+-]\d{1,3}\.\d+)([+-]\d+\.?\d*)?\//.exec(s);
  if (g) {
    lat = parseFloat(g[1]);
    lon = parseFloat(g[2]);
  }
  date ??= mvhdDate(b);
  if (date === null && lat === null) return null;
  return { date, lat, lon };
}

/** Erstellungszeit aus dem mvhd-Atom (Sekunden seit 1904), steht in jeder MP4/MOV-Datei. */
function mvhdDate(b: Uint8Array): number | null {
  for (let i = 4; i < b.length - 20; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue; // "mvhd"
    const v = new DataView(b.buffer, b.byteOffset + i + 4);
    const secs = v.getUint8(0) === 1 ? Number(v.getBigUint64(4)) : v.getUint32(4);
    const ms = (secs - 2082844800) * 1000;
    return ms > Date.UTC(2000, 0, 1) && ms < Date.now() + 864e5 ? ms : null;
  }
  return null;
}

/** Sucht einen TIFF-Header (EXIF) und liest DateTimeOriginal sowie GPS. Funktioniert für JPEG und HEIC. */
function parseExif(b: Uint8Array): CaptureInfo | null {
  let start = -1;
  for (let i = 0; i < b.length - 10; i++) {
    // "Exif\0\0" gefolgt von "II*\0" oder "MM\0*"
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
      const t = i + 6;
      if ((b[t] === 0x49 && b[t + 1] === 0x49) || (b[t] === 0x4d && b[t + 1] === 0x4d)) { start = t; break; }
    }
  }
  if (start < 0) return null;
  const view = new DataView(b.buffer, b.byteOffset + start, b.length - start);
  const le = b[start] === 0x49;
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const out: CaptureInfo = { date: null, lat: null, lon: null };
  const ok = (o: number, n = 2) => o >= 0 && o + n <= view.byteLength;

  const readIFD = (off: number, visit: (tag: number, type: number, count: number, valOff: number) => void) => {
    if (!ok(off)) return;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (!ok(e, 12)) return;
      visit(u16(e), u16(e + 2), u32(e + 4), e + 8);
    }
  };
  const ascii = (count: number, valOff: number) => {
    const o = count > 4 ? u32(valOff) : valOff;
    let s = '';
    for (let i = 0; i < count - 1 && ok(o + i, 1); i++) s += String.fromCharCode(view.getUint8(o + i));
    return s;
  };
  const rationals = (count: number, valOff: number) => {
    const o = u32(valOff);
    const r: number[] = [];
    for (let i = 0; i < count && ok(o + i * 8, 8); i++) r.push(u32(o + i * 8) / (u32(o + i * 8 + 4) || 1));
    return r;
  };

  let exifIFD = 0;
  let gpsIFD = 0;
  let dateFallback = '';
  try {
    readIFD(u32(4), (tag, _t, count, v) => {
      if (tag === 0x8769) exifIFD = u32(v);
      if (tag === 0x8825) gpsIFD = u32(v);
      if (tag === 0x0132) dateFallback = ascii(count, v);
    });
    let dateStr = '';
    if (exifIFD) readIFD(exifIFD, (tag, _t, count, v) => { if (tag === 0x9003) dateStr = ascii(count, v); });
    dateStr ||= dateFallback;
    const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dateStr);
    if (m) out.date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if (gpsIFD) {
      let latRef = 'N', lonRef = 'E';
      let lat: number[] = [], lon: number[] = [];
      readIFD(gpsIFD, (tag, _t, count, v) => {
        if (tag === 1) latRef = ascii(2, v);
        if (tag === 2) lat = rationals(count, v);
        if (tag === 3) lonRef = ascii(2, v);
        if (tag === 4) lon = rationals(count, v);
      });
      const dms = (a: number[]) => (a[0] ?? 0) + (a[1] ?? 0) / 60 + (a[2] ?? 0) / 3600;
      if (lat.length && lon.length) {
        out.lat = dms(lat) * (latRef.startsWith('S') ? -1 : 1);
        out.lon = dms(lon) * (lonRef.startsWith('W') ? -1 : 1);
      }
    }
  } catch {
    // beschädigte EXIF-Daten ignorieren
  }
  return out;
}
