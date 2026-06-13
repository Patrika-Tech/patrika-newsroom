/**
 * POST /api/archive/:id/transcribe
 *
 * Local Hindi transcription — no API key required.
 * Uses @xenova/transformers (Whisper small, quantized ~97 MB).
 * Model downloads once to .model-cache/ on first use.
 *
 * For non-WAV audio (MP3, M4A, OGG…), ffmpeg must be in PATH.
 * Download ffmpeg: https://ffmpeg.org/download.html
 */
const path      = require('path');
const fs        = require('fs');
const { spawn } = require('child_process');
const { query }       = require('../_lib/mysql');
const { requireRole } = require('../_lib/auth');
const { setCors, handleOptions } = require('../_lib/cors');

const UPLOAD_DIR  = path.join(__dirname, '..', '..', 'uploads', 'archive');
const MODEL_CACHE = path.join(__dirname, '..', '..', '.model-cache');

// ── Lazy-load pipeline (model downloads once, then cached on disk) ─────────────
let _transcriber = null;

async function getTranscriber() {
  if (_transcriber) return _transcriber;
  const { pipeline, env } = await import('@xenova/transformers');
  env.cacheDir         = MODEL_CACHE;
  env.allowLocalModels = false;
  console.log('[transcribe] Loading Whisper model (downloads once ~97 MB)…');
  _transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
    quantized: true,
  });
  console.log('[transcribe] Whisper model ready.');
  return _transcriber;
}

// ── Convert any audio/video → 16 kHz mono WAV using ffmpeg ───────────────────
function convertToWav(inputPath) {
  const outPath = inputPath + '_16k.wav';
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outPath,
    ]);
    const stderr = [];
    ff.stderr.on('data', d => stderr.push(d.toString()));
    ff.on('close', code => {
      if (code === 0) return resolve(outPath);
      reject(new Error('ffmpeg exited ' + code + ': ' + stderr.slice(-3).join('')));
    });
    ff.on('error', err => reject(new Error('ffmpeg not found: ' + err.message)));
  });
}

// ── HTTP handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { authError } = requireRole(req, ['Admin', 'State Head', 'Regional Editor']);
  if (authError) return res.status(authError.status).json({ error: authError.message });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const rows = await query('SELECT * FROM archive_files WHERE id = ?', [id]).catch(() => []);
  if (!rows.length) return res.status(404).json({ error: 'File not found' });
  const file = rows[0];

  if (file.file_type !== 'video' && file.file_type !== 'audio') {
    return res.status(400).json({ error: 'Only video and audio files can be transcribed' });
  }

  const filePath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  // Respond immediately — transcription runs in background
  await query("UPDATE archive_files SET transcript_status = 'pending' WHERE id = ?", [id]);
  res.json({
    ok: true,
    message: 'Transcription started. First run downloads the Whisper model (~97 MB). Please wait a few minutes…',
  });

  // ── Background transcription ───────────────────────────────────────────────
  (async () => {
    let tmpWav = null;
    try {
      const transcriber = await getTranscriber();

      // Convert to 16 kHz WAV (Whisper requirement)
      let audioPath = filePath;
      const isWav = filePath.toLowerCase().endsWith('.wav');
      try {
        tmpWav    = await convertToWav(filePath);
        audioPath = tmpWav;
      } catch (ffErr) {
        if (!isWav) {
          console.warn('[transcribe] ffmpeg unavailable:', ffErr.message);
          console.warn('[transcribe] Attempting direct read (only WAV is guaranteed to work without ffmpeg)');
        }
        // For WAV files without ffmpeg, proceed with original path
      }

      const result = await transcriber(audioPath, {
        language: 'hindi',
        task:     'transcribe',
        chunk_length_s:  30,
        stride_length_s:  5,
        return_timestamps: false,
      });

      // result may be { text: '…' } or an array of chunks
      const transcript = Array.isArray(result)
        ? result.map(r => r.text || '').join(' ').trim()
        : (result.text || '').trim();

      await query(
        "UPDATE archive_files SET transcript_status='done', transcript_text=?, transcript_summary='' WHERE id=?",
        [transcript, id]
      );
      console.log('[transcribe] Done — id:', id, '| chars:', transcript.length);

    } catch (err) {
      console.error('[transcribe] Failed:', err.message);
      await query(
        "UPDATE archive_files SET transcript_status='failed' WHERE id=?",
        [id]
      ).catch(() => {});
    } finally {
      if (tmpWav) fs.unlink(tmpWav, () => {});
    }
  })();
};
