/**
 * POST /api/legal-notices/parse
 * Accepts:  notice_pdf (single PDF), cuttings[] (image/pdf files), doc_names (JSON array)
 * Returns:  OCR-extracted fields from scanned Indian legal notice PDFs
 *
 * OCR pipeline: pdfjs-dist v3 (CJS) -> node-canvas -> tesseract.js (eng+hin, no API key)
 * Lazy-loaded and cached — first call takes ~10-20s, subsequent calls are fast.
 */
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const { requireRole } = require('../_lib/auth');
const { setCors }     = require('../_lib/cors');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'legal-notices');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /\.(pdf|jpg|jpeg|png|webp)$/i.test(file.originalname)),
}).fields([
  { name: 'notice_pdf', maxCount: 1 },
  { name: 'cuttings',   maxCount: 20 },
]);

// ── Lazy OCR init ─────────────────────────────────────────────────────────────
let _pdfjsLib     = null;
let _Tesseract    = null;
let _createCanvas = null;

async function initOcr() {
  if (_pdfjsLib) return;
  _pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  _pdfjsLib.GlobalWorkerOptions.workerSrc =
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
  _createCanvas = require('canvas').createCanvas;
  const tessModule = await import('tesseract.js');
  _Tesseract = tessModule.default || tessModule;
}

class NodeCanvasFactory {
  create(w, h)    { const c = _createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc)     { cc.canvas.width = 0; cc.canvas.height = 0; }
}

const TESS_CACHE = path.join(__dirname, '..', '..', '.model-cache', 'tesseract');

// ── OCR a PDF -> combined text string ─────────────────────────────────────────
async function ocrPdf(filePath) {
  await initOcr();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const canvasFactory = new NodeCanvasFactory();
  const doc = await _pdfjsLib.getDocument({ data, canvasFactory, verbosity: 0 }).promise;

  let fullText = '';
  const pagesToScan = Math.min(doc.numPages, 4);
  for (let i = 1; i <= pagesToScan; i++) {
    const page = await doc.getPage(i);
    const vp   = page.getViewport({ scale: 2.5 });
    const cc   = canvasFactory.create(vp.width, vp.height);
    try {
      await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory }).promise;
    } catch { /* skip tiny/broken pages */ }
    const png = cc.canvas.toBuffer('image/png');
    const res = await _Tesseract.recognize(png, 'eng+hin', {
      logger: () => {},
      langPath: TESS_CACHE,
    });
    fullText += res.data.text + '\n\n';
    canvasFactory.destroy(cc);
  }
  return fullText;
}

// ── Field extractors (calibrated against real scanned Indian legal notice PDFs) ──
const KNOWN_STATES = [
  'Rajasthan', 'Madhya Pradesh', 'Chhattisgarh', 'Maharashtra', 'Gujarat', 'Delhi',
  'Uttar Pradesh', 'Bihar', 'Jharkhand', 'Odisha', 'West Bengal', 'Punjab',
  'Haryana', 'Himachal Pradesh', 'Uttarakhand', 'Karnataka', 'Tamil Nadu',
  'Andhra Pradesh', 'Telangana', 'Kerala', 'Goa', 'Assam', 'Meghalaya',
];

const CITY_LIST = [
  'Jaipur','Mumbai','Delhi','Bhopal','Raipur','Lucknow','Patna','Chandigarh',
  'Ahmedabad','Hyderabad','Bangalore','Bengaluru','Satna','Gwalior','Indore',
  'Nagpur','Jodhpur','Udaipur','Kota','Ajmer','Alwar','Bikaner','Surat',
  'Vadodara','Pune','Nashik','Aurangabad','Ghaziabad','Noida','Kanpur',
  'Varanasi','Agra','Meerut','Jabalpur','Rewa','Sagar','Ujjain','Raigarh',
  'Bilaspur','Durg','Bhilai','Kolkata','Chennai','Bhubaneswar','Ranchi',
];

function extractAdvocate(t) {
  // "LAW CHAMBERS\nNAME" — name on the line AFTER the firm name
  const afterFirm = t.match(/(?:LAW CHAMBERS?|& ASSOCIATES?|ADVOCATES?)\s*\n\s*([A-Z][A-Z.\s]{3,35}?)(?:\s*[;,\]\|]|\s*\n)/im);
  if (afterFirm) return afterFirm[1].replace(/\s+/g, ' ').trim();

  // "NAME\nLAW CHAMBERS" — name on the line BEFORE the firm name (some letterheads)
  const beforeFirm = t.match(/\n([A-Z]{2,}(?:[\s.][A-Z]{2,}){1,3})\s*\n[^\n]*(?:LAW CHAMBERS?|ASSOCIATES?|ADVOCATE)/im);
  if (beforeFirm) {
    const name = beforeFirm[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 5) return name;
  }

  // "Name, Advocate" or "Name (Advocate)"
  const comma = t.match(/([A-Z][A-Za-z.'\s]{3,40}?)\s*,\s*(?:Sr\.\s+)?Advocate/i);
  if (comma) return comma[1].replace(/\s+/g, ' ').trim();

  // "Adv. Name"
  const adv = t.match(/Adv\.?\s+([A-Z][A-Za-z.\s]{3,40})/);
  if (adv) return adv[1].replace(/\s+/g, ' ').trim();

  return '';
}

function extractDate(t) {
  // Look specifically in the "DATE:" area first
  const dateArea = t.match(/DATE\s*[:\-]?\s*([^\n]{0,60})/i);
  if (dateArea) {
    const area = dateArea[1];
    // Full date DD/MM/YYYY or DD-MM-YYYY
    const full = area.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (full) return `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`;
    // Month-year only (day garbled by OCR): "05-2026" or "05/2026"
    const my = area.match(/(\d{1,2})[\/\-](\d{4})/);
    if (my) return `${my[2]}-${my[1].padStart(2, '0')}-01`;
  }

  // Written date: "15th June 2025"
  const MONTHS = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
  const pw = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(\d{4})/i);
  if (pw) {
    const m = MONTHS[pw[2]] || 1;
    return `${pw[3]}-${String(m).padStart(2, '0')}-${pw[1].padStart(2, '0')}`;
  }

  // Fallback: any DD.MM.YYYY in full text
  const p1 = t.match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/);
  if (p1) return `${p1[3]}-${p1[2].padStart(2, '0')}-${p1[1].padStart(2, '0')}`;

  return '';
}

function extractInFavourOf(t) {
  // "TO," may be on the same line as "DATE:" — get the NEXT lines before SUBJECT
  const toSection = t.match(/\bTO[,\s][^\n]*\n([\s\S]{0,500}?)(?:SUBJECT|SUB\b|RE\b)/i);
  if (toSection) {
    const lines = toSection[1]
      .split('\n')
      .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())   // strip "1." prefix
      .filter(l => l.length > 4 && !/^(Email|Through|Addressee|Address|via|By Speed|By Regd|Ko\b)/i.test(l));
    if (lines.length) return lines.slice(0, 4).join(', ').slice(0, 300);
  }

  // "TO:\n" block (strict newline version)
  const toBlock = t.match(/\bTO[,:]?\s*\n([\s\S]{0,400}?)(?:\n\s*\n|SUBJECT|SUB\s*:|RE\s*:|Madam|Sir,)/i);
  if (toBlock) {
    return toBlock[1].split('\n').map(l => l.trim()).filter(l => l.length > 3).slice(0, 4).join(', ').slice(0, 300);
  }

  // Editor / Publisher pattern
  const ed = t.match(/((?:The\s+)?(?:Editor|Chief Editor|Managing Director|MD|Publisher)[^\n]*(?:\n[^\n]{0,80}){0,2})/i);
  if (ed) return ed[1].replace(/\n/g, ', ').trim().slice(0, 300);

  return '';
}

function extractState(t) {
  for (const s of KNOWN_STATES) {
    if (new RegExp(`\\b${s}\\b`, 'i').test(t)) return s;
  }
  return '';
}

function extractBranch(t) {
  // "City, State" pattern — take the last 1-2 words right before the state name
  const stateAlt = KNOWN_STATES.map(s => s.replace(/ /g, '\\s+')).join('|');
  const beforeState = t.match(new RegExp(`([A-Za-z][A-Za-z\\s]{1,20}),\\s*(?:${stateAlt})\\b`, 'i'));
  if (beforeState) {
    const words = beforeState[1].trim().split(/\s+/);
    const city = words.slice(-2).join(' ');
    // Reject road-type suffixes
    if (!/^(Marg|Nagar|Road|Street|Lane|Colony|Chowk)$/i.test(city.trim())) return city;
    if (words.length > 1) return words[words.length - 1];
  }

  // Explicit city keyword lookup (fast path)
  const cityPat = new RegExp(`\\b(${CITY_LIST.join('|')})\\b`, 'i');
  const cm = t.match(cityPat);
  if (cm) return cm[0];

  // City right before 6-digit PIN, skipping state names
  const pinM = t.match(/([A-Za-z][A-Za-z\s]{1,20}?)\s*[-–]?\s*\d{6}/);
  if (pinM) {
    const w = pinM[1].trim().split(/\s+/).pop();
    if (w && w.length > 2 && !KNOWN_STATES.some(s => s.toLowerCase() === w.toLowerCase())) return w;
  }

  return '';
}

function extractMatter(t) {
  // Text block after SUBJECT: — filter out garbled footer lines (< 8 chars)
  const subM = t.match(/SUBJECT\s*[:\-]\s*([\s\S]{0,1000}?)(?:\n\s*\n[A-Zऀ-ॿ]|\nSir,|\nMadam,|\nDear\s)/i)
            || t.match(/SUB\s*[:\-]\s*([\s\S]{0,800}?)(?:\n\s*\n|\nSir,|\nMadam,)/i);
  if (subM) {
    const lines = subM[1].split('\n').filter(l => {
      const tr = l.trim();
      return tr.length >= 8 && !/^[A-Z\s]{1,5}$/.test(tr);
    });
    return lines.join(' ').replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 50).join(' ');
  }

  // Fallback: first 50 words of body after salutation
  const salM = t.match(/\bSir\s*,\s*\n([\s\S]{0,500})/i);
  if (salM) {
    return salM[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 50).join(' ');
  }

  return '';
}

// ── Route handler ─────────────────────────────────────────────────────────────
module.exports = function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { authError } = requireRole(req, ['Admin', 'State Head', 'Regional Editor', 'Legal']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const noticePdfFile = req.files?.notice_pdf?.[0];
    const cuttingFiles  = req.files?.cuttings || [];

    let docNames = [];
    try { docNames = JSON.parse(req.body?.doc_names || '[]'); } catch {}

    const cuttings = cuttingFiles.map((f, i) => ({
      filename:      f.filename,
      original_name: f.originalname,
      doc_name:      docNames[i] || f.originalname,
    }));

    if (!noticePdfFile) {
      return res.json({
        ok: true,
        parsed: { state:'', branch:'', advocate_name:'', notice_date:'', notice_in_favour_of:'', matter_summary:'' },
        pdf_filename: '', pdf_original_name: '', cuttings,
      });
    }

    try {
      const text = await ocrPdf(noticePdfFile.path);
      const parsed = {
        state:               extractState(text),
        branch:              extractBranch(text),
        advocate_name:       extractAdvocate(text),
        notice_date:         extractDate(text),
        notice_in_favour_of: extractInFavourOf(text),
        matter_summary:      extractMatter(text),
      };
      return res.json({
        ok: true, parsed,
        pdf_filename:      noticePdfFile.filename,
        pdf_original_name: noticePdfFile.originalname,
        raw_text:          text.slice(0, 8000),
        cuttings,
      });
    } catch (ocrErr) {
      console.error('[legal-notice OCR]', ocrErr.message);
      return res.json({
        ok: true,
        parsed: { state:'', branch:'', advocate_name:'', notice_date:'', notice_in_favour_of:'', matter_summary:'' },
        pdf_filename:      noticePdfFile.filename,
        pdf_original_name: noticePdfFile.originalname,
        raw_text: '',
        cuttings,
        warning: 'OCR failed — please fill fields manually. ' + ocrErr.message,
      });
    }
  });
};
