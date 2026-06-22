/**
 * POST /api/news-generator
 * Accepts: multipart with file (PDF / DOCX / image / TXT) + form fields
 *   length        — 'short' | 'medium' | 'detailed'
 *   city          — city name for byline
 *   value_edition — '1' | '0'
 * Returns: { headline, sub_headline, text, ve_headline, ve_text }
 */
const multer  = require('multer');
const path    = require('path');
const fetch   = require('node-fetch');
const { requireRole }            = require('./_lib/auth');
const { setCors, handleOptions } = require('./_lib/cors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
}).single('file');

// ── Word targets ──────────────────────────────────────────────────────────────
const WORD_RANGE = {
  short:    { min: 100, max: 150 },
  medium:   { min: 150, max: 200 },
  detailed: { min: 200, max: 250 },
};

// ── Text extraction ───────────────────────────────────────────────────────────
async function extractText(buffer, mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase();

  if (ext === '.pdf' || mimetype === 'application/pdf') {
    try {
      const data = await require('pdf-parse')(buffer);
      return (data.text || '').trim();
    } catch {
      return buffer.toString('latin1').replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
    }
  }

  if (ext === '.docx' || mimetype.includes('wordprocessingml')) {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return (result.value || '').trim();
  }

  if (ext === '.doc' || mimetype.includes('msword')) {
    try {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ buffer });
      return (result.value || '').trim();
    } catch {
      return buffer.toString('latin1').replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
    }
  }

  if (/\.(jpg|jpeg|png|webp|bmp|tiff?)$/i.test(ext) || mimetype.startsWith('image/')) {
    // OCR via tesseract.js
    const Tesseract = require('tesseract.js');
    const tessPath  = path.join(__dirname, '..', '.model-cache', 'tesseract');
    const result    = await Tesseract.recognize(buffer, 'eng+hin', {
      logger:   () => {},
      langPath: tessPath,
    });
    return (result.data.text || '').trim();
  }

  // Plain text / TXT / anything else
  return buffer.toString('utf8').trim();
}

// ── OpenAI call ───────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userContent) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       'gpt-4o-mini',
      temperature: 0.4,
      max_tokens:  1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ── Parse structured JSON from LLM response ───────────────────────────────────
function parseJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

// ── Route handler ─────────────────────────────────────────────────────────────
module.exports = function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { authError, user } = requireRole(req, ['Admin', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is not configured. Please add it to .env' });
  }

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { length = 'short', city = '', value_edition = '0' } = req.body || {};
    const range   = WORD_RANGE[length] || WORD_RANGE.short;
    const wantVE  = value_edition === '1' || value_edition === true;
    const cityStr = (city || '').trim();
    const byline  = cityStr ? `${cityStr}@पत्रिका` : '@पत्रिका';

    let sourceText = '';

    if (req.file) {
      try {
        sourceText = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
      } catch (e) {
        return res.status(422).json({ error: 'File extraction failed: ' + e.message });
      }
    }

    if (!sourceText || sourceText.length < 20) {
      return res.status(422).json({ error: 'Could not extract enough text from the file. Please try a different file.' });
    }

    // Truncate very long source text to avoid token overflow
    const input = sourceText.slice(0, 6000);

    const systemPrompt = `
आप एक वरिष्ठ हिंदी पत्रकार हैं जो Patrika newspaper के लिए समाचार लिखते हैं।
आपका काम दिए गए स्रोत सामग्री के आधार पर हिंदी में समाचार तैयार करना है।

नियम:
- पूरा आउटपुट केवल हिंदी में होना चाहिए
- समाचार पाठ में byline "${byline}," से शुरू करें
- समाचार पाठ ${range.min} से ${range.max} शब्दों का होना चाहिए
- headline आकर्षक और संक्षिप्त हो (8-12 शब्द)
- sub_headline headline को विस्तार दे (10-16 शब्द)
${wantVE ? `- value_edition_text: 55 से 65 शब्दों में संक्षिप्त संस्करण, byline "${byline}," से शुरू हो\n- value_edition_headline: value edition के लिए अलग संक्षिप्त headline (8-10 शब्द)` : ''}
- केवल JSON आउटपुट दें, कोई अतिरिक्त टेक्स्ट नहीं

JSON format:
{
  "headline": "...",
  "sub_headline": "...",
  "text": "${byline}, ...",
  "ve_headline": "${wantVE ? '...' : ''}",
  "ve_text": "${wantVE ? byline + ', ...' : ''}"
}
`.trim();

    try {
      const raw    = await callOpenAI(systemPrompt, `स्रोत सामग्री:\n\n${input}`);
      const parsed = parseJSON(raw);

      return res.json({
        headline:    parsed.headline    || '',
        sub_headline: parsed.sub_headline || '',
        text:        parsed.text        || '',
        ve_headline: wantVE ? (parsed.ve_headline || '') : '',
        ve_text:     wantVE ? (parsed.ve_text     || '') : '',
      });
    } catch (e) {
      console.error('[news-generator]', e.message);
      return res.status(500).json({ error: 'News generation failed: ' + e.message });
    }
  });
};
