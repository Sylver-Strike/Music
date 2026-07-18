const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const NodeID3 = require('node-id3');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const bcrypt = require('bcryptjs');

// Paths to bundled binaries
const isWin = process.platform === 'win32';
let YTDLP_PATH = isWin
  ? path.join(__dirname, 'bin', 'yt-dlp.exe')
  : (fs.existsSync(path.join(__dirname, 'bin', 'yt-dlp'))
      ? path.join(__dirname, 'bin', 'yt-dlp')
      : (process.env.YTDLP_PATH || 'yt-dlp'));



const app = express();
const PORT = process.env.PORT || 4000;

// Simple CORS middleware to allow the Android App to connect
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Directories
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'temp_cache');
const BASE_LIBRARY_DIR = process.env.LIBRARY_DIR || path.join(__dirname, 'library');

// Users database file
const USERS_DB = path.join(__dirname, 'users.json');

// Ensure directories exist
try {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  if (!fs.existsSync(path.join(PUBLIC_DIR, 'css'))) fs.mkdirSync(path.join(PUBLIC_DIR, 'css'), { recursive: true });
  if (!fs.existsSync(path.join(PUBLIC_DIR, 'js'))) fs.mkdirSync(path.join(PUBLIC_DIR, 'js'), { recursive: true });
} catch (err) {
  console.error(`[Warning] Failed to create directories in PUBLIC_DIR: ${err.message}`);
}

try {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (err) {
  console.error(`[Warning] Failed to create CACHE_DIR: ${err.message}`);
}

try {
  if (!fs.existsSync(BASE_LIBRARY_DIR)) fs.mkdirSync(BASE_LIBRARY_DIR, { recursive: true });
} catch (err) {
  console.error(`[Warning] Failed to create BASE_LIBRARY_DIR: ${err.message}`);
}

// Initialize users.json if missing
try {
  if (!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, '[]', 'utf-8');
} catch (err) {
  console.error(`[Warning] Failed to initialize USERS_DB: ${err.message}`);
}

// Base64 Cookies decoding support (free workaround for Render)
const COOKIES_FILE_PATH = path.join(__dirname, 'cookies.txt');
if (process.env.YTDLP_COOKIES_B64) {
  try {
    // Strip ALL whitespace before decoding — Render's UI injects hidden newlines
    // that cause Buffer.from() to silently truncate the decoded output
    const cleanB64 = process.env.YTDLP_COOKIES_B64.replace(/\s+/g, '');
    const decodedCookies = Buffer.from(cleanB64, 'base64').toString('utf-8');
    fs.writeFileSync(COOKIES_FILE_PATH, decodedCookies, 'utf-8');
    console.log(`[Engine] Decoded cookies.txt — ${decodedCookies.length} chars written (b64 input: ${cleanB64.length} chars)`);
  } catch (err) {
    console.error(`[Engine] Failed to write decoded base64 cookies: ${err.message}`);
  }
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Memory store for job statuses
const jobs = new Map();
const jobQueue = [];

// In-memory session store: token -> { username, createdAt }
const sessions = new Map();

// Verify yt-dlp binary exists
if (isWin) {
  if (!fs.existsSync(YTDLP_PATH)) {
    console.error(`[FATAL] yt-dlp.exe not found at ${YTDLP_PATH}. Run the setup to download it.`);
  } else {
    console.log(`[Engine] yt-dlp binary found: ${YTDLP_PATH}`);
    console.log(`[Engine] ffmpeg binary found: ${ffmpegPath}`);
  }
} else {
  // Test if local binary works, if not fall back to global
  try {
    const { execSync } = require('child_process');
    execSync(`"${YTDLP_PATH}" --version`, { stdio: 'ignore' });
    console.log(`[Engine] Configured for Linux/Unix. Using yt-dlp: ${YTDLP_PATH}`);
  } catch (err) {
    console.warn(`[Warning] Local yt-dlp at ${YTDLP_PATH} is not executable or failed: ${err.message}. Trying global 'yt-dlp'...`);
    try {
      const { execSync } = require('child_process');
      execSync('yt-dlp --version', { stdio: 'ignore' });
      YTDLP_PATH = 'yt-dlp';
      console.log(`[Engine] Configured for Linux/Unix. Falling back to global yt-dlp: ${YTDLP_PATH}`);
    } catch (globalErr) {
      console.error(`[FATAL] Neither local nor global yt-dlp is working: ${globalErr.message}`);
    }
  }
  console.log(`[Engine] ffmpeg binary found: ${ffmpegPath}`);
}

// SSRF Host validation helper
function isPrivateIP(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === 'loopback') return true;
  
  // Quick check for local IP patterns
  const parts = hostname.split('.');
  if (parts.length === 4) {
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);
    if (p1 === 127 || p1 === 10 || p1 === 0) return true;
    if (p1 === 192 && p2 === 168) return true;
    if (p1 === 172 && (p2 >= 16 && p2 <= 31)) return true;
  }
  if (hostname.includes(':') || hostname === '::1') return true; // IPv6 check
  return false;
}

// XSS/Input Sanitization helper
function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&#39;';
      case '"': return '&quot;';
      default: return char;
    }
  });
}

// ----------------------------------------------------
// USER / AUTH HELPERS
// ----------------------------------------------------
function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_DB, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_DB, JSON.stringify(users, null, 2), 'utf-8');
}

function getUserLibraryDir(username) {
  const dir = path.join(BASE_LIBRARY_DIR, username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getUserLibraryDB(username) {
  const dbPath = path.join(getUserLibraryDir(username), 'library.json');
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '[]', 'utf-8');
  return dbPath;
}

// Session token extraction middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  // Also accept token from query param (needed for audio/video streaming where
  // the browser's <audio> element cannot set custom Authorization headers)
  const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null)
    || req.query.token
    || null;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.session = sessions.get(token);
  req.username = req.session.username;
  next();
}

// ----------------------------------------------------
// LIBRARY PERSISTENCE HELPERS (per-user)
// ----------------------------------------------------
function readLibrary(username) {
  try {
    const dbPath = getUserLibraryDB(username);
    const raw = fs.readFileSync(dbPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[Library] Failed to read library:', e.message);
    return [];
  }
}

function writeLibrary(username, data) {
  try {
    const dbPath = getUserLibraryDB(username);
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Library] Failed to write library:', e.message);
  }
}

function addToLibrary(username, track) {
  const lib = readLibrary(username);
  // Avoid duplicates by URL + quality
  const exists = lib.find(t => t.sourceUrl === track.sourceUrl && t.quality === track.quality && t.type === track.type);
  if (exists) {
    console.log(`[Library:${username}] Track already exists: "${track.title}" [${track.quality}]`);
    return exists;
  }
  lib.push(track);
  writeLibrary(username, lib);
  console.log(`[Library:${username}] Added: "${track.title}" [${track.quality}]`);
  return track;
}

function removeFromLibrary(username, id) {
  let lib = readLibrary(username);
  const track = lib.find(t => t.id === id);
  if (!track) return null;
  lib = lib.filter(t => t.id !== id);
  writeLibrary(username, lib);
  return track;
}

// Get video metadata using Open Graph
async function extractMetadata(urlStr) {
  try {
    const parsedUrl = new URL(urlStr);
    
    // SSRF Check
    if (isPrivateIP(parsedUrl.hostname)) {
      throw new Error('SSRF protection: Invalid or private hostname.');
    }

    let title = '';
    let thumbnail = '';
    let duration = '3:15'; // Default fallback duration
    let source = parsedUrl.hostname.replace('www.', '');

    // YouTube specific fast parsing
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|user\/(?:[^\/]+)\/|shorts\/)|youtu\.be\/)([^"&?\/ ]{11})/;
    const ytMatch = urlStr.match(ytRegex);
    if (ytMatch && ytMatch[1]) {
      const videoId = ytMatch[1];
      thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      source = 'YouTube';
    }

    // Attempt fetching the page HTML for general scraping
    try {
      const response = await axios.get(urlStr, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 6000
      });

      const $ = cheerio.load(response.data);

      // Extract title
      title = $('meta[property="og:title"]').attr('content') || 
              $('meta[name="twitter:title"]').attr('content') || 
              $('title').text();

      // Extract thumbnail
      if (!thumbnail) {
        thumbnail = $('meta[property="og:image"]').attr('content') || 
                    $('meta[name="twitter:image"]').attr('content') || 
                    $('link[rel="image_src"]').attr('href') || 
                    '';
      }

      // Extract duration
      const durationMeta = $('meta[property="video:duration"]').attr('content') || 
                           $('meta[property="music:duration"]').attr('content') || 
                           $('meta[name="duration"]').attr('content');
      if (durationMeta) {
        const secs = parseInt(durationMeta, 10);
        if (!isNaN(secs)) {
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          duration = `${m}:${s < 10 ? '0' : ''}${s}`;
        } else {
          duration = durationMeta;
        }
      }
    } catch (fetchErr) {
      console.warn(`Scraping page failed: ${fetchErr.message}. Falling back to default metadata generation.`);
    }

    // Sanitization & Default fallbacks
    title = sanitizeInput(title.trim()) || `Audio Track from ${source}`;
    thumbnail = thumbnail || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=400&auto=format&fit=crop';
    
    return { title, thumbnail, duration, source };

  } catch (error) {
    throw new Error(`Failed to parse URL metadata: ${error.message}`);
  }
}

// ----------------------------------------------------
// AUTH ROUTES
// ----------------------------------------------------

// Register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  // Sanitize username: only alphanumeric + underscores
  const sanitizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (sanitizedUsername.length < 2) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, and underscores.' });
  }

  const users = readUsers();
  if (users.find(u => u.username === sanitizedUsername)) {
    return res.status(409).json({ error: 'Username already taken. Please choose another.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ username: sanitizedUsername, passwordHash, createdAt: Date.now() });
  writeUsers(users);

  // Auto-create their library dir
  getUserLibraryDir(sanitizedUsername);

  // Issue token
  const token = uuidv4();
  sessions.set(token, { username: sanitizedUsername, createdAt: Date.now() });

  console.log(`[Auth] Registered new user: ${sanitizedUsername}`);
  res.status(201).json({ token, username: sanitizedUsername });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const sanitizedUsername = username.trim().toLowerCase();
  const users = readUsers();
  const user = users.find(u => u.username === sanitizedUsername);

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = uuidv4();
  sessions.set(token, { username: sanitizedUsername, createdAt: Date.now() });

  console.log(`[Auth] User logged in: ${sanitizedUsername}`);
  res.json({ token, username: sanitizedUsername });
});

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.slice(7);
  sessions.delete(token);
  console.log(`[Auth] User logged out: ${req.username}`);
  res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.username });
});

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// FR-02: URL Validation & Metadata Fetching
app.post('/api/fetch-metadata', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Basic URL regex test
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format. Please enter a valid HTTP/HTTPS link.' });
  }

  try {
    const metadata = await extractMetadata(url);
    res.json(metadata);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// FR-03 & FR-04: Audio Extraction & Job Creation (requires auth)
app.post('/api/convert', authMiddleware, (req, res) => {
  const { url, quality, title, thumbnail, duration, source, type } = req.body;
  
  const isVideo = type === 'video';

  if (!url) {
    return res.status(400).json({ error: 'Missing required parameter (url)' });
  }

  // Quality is required for audio, optional for video
  if (!isVideo) {
    if (!quality) {
      return res.status(400).json({ error: 'Missing required parameter (quality) for audio extraction.' });
    }
    const allowedQualities = ['128kbps', '192kbps', '320kbps'];
    if (!allowedQualities.includes(quality)) {
      return res.status(400).json({ error: 'Unsupported quality selection.' });
    }
  }

  const jobId = uuidv4();
  const job = {
    id: jobId,
    userId: req.username,  // <-- scoped to this user
    url,
    type: isVideo ? 'video' : 'audio',
    quality: quality || '192kbps',
    title: title || (isVideo ? 'SonicFetch Video' : 'SonicFetch Audio'),
    thumbnail: thumbnail || '',
    duration: duration || '3:00',
    source: source || 'Web',
    status: 'pending',
    progress: 0,
    filePath: null,
    error: null,
    createdAt: Date.now()
  };

  jobs.set(jobId, job);
  jobQueue.push(jobId);
  
  // Trigger processing queue async
  processQueue();

  res.status(202).json({ jobId, type: job.type });
});

// FR-06: Progress Indicator & Job Status
app.get('/api/status/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: job.id,
    type: job.type || 'audio',
    status: job.status,
    progress: job.progress,
    title: job.title,
    thumbnail: job.thumbnail,
    error: job.error
  });
});

// FR-05: One-Click Music Download — Robust Streaming with Auto-Purge
app.get('/api/download/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);

  // Guard: job must exist, be ready, and have a file path
  if (!job || job.status !== 'ready' || !job.filePath) {
    return res.status(404).json({ error: 'File not ready or has already been purged.' });
  }

  const filePath = job.filePath;

  // Guard: file must physically exist on disk
  if (!fs.existsSync(filePath)) {
    jobs.delete(id); // Clean orphaned job from memory
    return res.status(404).json({ error: 'Audio file not found on disk. It may have been auto-purged.' });
  }

  // Build a safe, RFC 5987-compliant filename for Content-Disposition
  const rawTitle = job.title.replace(/[^a-zA-Z0-9\s\-_()]/g, '').trim() || 'audio';
  const downloadName = `${rawTitle} - ${job.quality}.mp3`;
  const encodedName = encodeURIComponent(downloadName);

  // Get file size for Content-Length (required by some browsers to show save dialog)
  let fileSize;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch (statErr) {
    console.error(`[Download] Failed to stat file: ${statErr.message}`);
    return res.status(500).json({ error: 'Failed to read file metadata.' });
  }

  // Set all download-forcing headers BEFORE streaming
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Accept-Ranges', 'bytes');

  // Create a read stream — avoids loading the entire file into memory
  const readStream = fs.createReadStream(filePath);

  // Handle stream errors (e.g., file deleted mid-transfer)
  readStream.on('error', (streamErr) => {
    console.error(`[Download] Stream error for job ${id}:`, streamErr.message);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream error during file transfer.' });
    } else {
      res.destroy(); // Force-close broken connection
    }
  });

  // Handle client disconnect (user cancels download) — destroy stream to free resources
  req.on('close', () => {
    if (!res.writableEnded) {
      console.warn(`[Download] Client disconnected mid-download for job ${id}. Destroying stream.`);
      readStream.destroy();
    }
  });

  // On successful stream finish: clean memory reference
  res.on('finish', () => {
    console.log(`[Storage] Job ${id} downloaded successfully.`);
    jobs.delete(id);
  });

  // Pipe the file stream directly to the HTTP response
  readStream.pipe(res);
});

// /api/download-video/:id — Robust Video File Download Endpoint
// Supports any video MIME type stored in job.mimeType (e.g. video/mp4, video/webm)
app.get('/api/download-video/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job || job.status !== 'ready' || !job.filePath) {
    return res.status(404).json({ error: 'Video job not ready or has been purged.' });
  }

  const filePath = job.filePath;

  if (!fs.existsSync(filePath)) {
    jobs.delete(id);
    return res.status(404).json({ error: 'Video file not found. It may have expired.' });
  }

  // Detect extension to set correct MIME type
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.mkv':  'video/x-matroska',
    '.mov':  'video/quicktime',
    '.avi':  'video/x-msvideo',
    '.mp3':  'audio/mpeg',
    '.m4a':  'audio/mp4',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  const rawTitle = (job.title || 'video').replace(/[^a-zA-Z0-9\s\-_()]/g, '').trim();
  const downloadName = `${rawTitle}${ext}`;
  const encodedName = encodeURIComponent(downloadName);

  let fileSize;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch (statErr) {
    return res.status(500).json({ error: 'Failed to read video file metadata.' });
  }

  // Support HTTP Range requests (enables browser seek bar and resume)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end   = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    res.status(206); // Partial Content
    res.setHeader('Content-Range',  `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Accept-Ranges',  'bytes');
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Type',   mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);

    const rangeStream = fs.createReadStream(filePath, { start, end });
    rangeStream.on('error', (e) => {
      console.error(`[VideoDownload] Range stream error for job ${id}:`, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Range stream error.' });
      else res.destroy();
    });
    req.on('close', () => { if (!res.writableEnded) rangeStream.destroy(); });
    return rangeStream.pipe(res);
  }

  // Full file download (no Range header)
  res.setHeader('Content-Type',        mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Length',      fileSize);
  res.setHeader('Cache-Control',       'no-cache, no-store, must-revalidate');
  res.setHeader('Accept-Ranges',       'bytes');

  const videoStream = fs.createReadStream(filePath);

  videoStream.on('error', (e) => {
    console.error(`[VideoDownload] Stream error for job ${id}:`, e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Video stream error.' });
    else res.destroy();
  });

  req.on('close', () => {
    if (!res.writableEnded) {
      console.warn(`[VideoDownload] Client disconnected mid-download for job ${id}.`);
      videoStream.destroy();
    }
  });

  res.on('finish', () => {
    console.log(`[Storage] Video job ${id} downloaded. Auto-purging.`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      jobs.delete(id);
    } catch (e) {
      console.error(`[Storage] Purge failed for video job ${id}:`, e.message);
    }
  });

  videoStream.pipe(res);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', jobsActive: jobs.size, queueLength: jobQueue.length });
});

// Debug / health detail endpoint
app.get('/api/debug-cookies', (req, res) => {
  const cookiesPath = process.env.YTDLP_COOKIES || path.join(__dirname, 'cookies.txt');
  const exists = fs.existsSync(cookiesPath);
  const size = exists ? fs.statSync(cookiesPath).size : 0;

  const { execSync } = require('child_process');
  let ytdlpVersion = 'unknown';
  let ffmpegStaticVersion = 'unknown';
  try { ytdlpVersion = execSync(`"${YTDLP_PATH}" --version`, { encoding: 'utf-8' }).trim(); } catch (e) { ytdlpVersion = `Error: ${e.message}`; }
  try { ffmpegStaticVersion = execSync(`"${ffmpegPath}" -version`, { encoding: 'utf-8' }).split('\n')[0].trim(); } catch (e) { ffmpegStaticVersion = `Error: ${e.message}`; }

  res.json({
    platform: process.platform,
    nodeVersion: process.version,
    ytdlpPath: YTDLP_PATH,
    ytdlpVersion,
    ffmpegStaticPath: ffmpegPath,
    ffmpegStaticVersion,
    cookiesFileExists: exists,
    cookiesFileSize: size,
    envVarExists: !!process.env.YTDLP_COOKIES_B64
  });
});


// ----------------------------------------------------
// LIBRARY API ENDPOINTS (all require auth)
// ----------------------------------------------------

// List all tracks in user's library
app.get('/api/library', authMiddleware, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const lib = readLibrary(req.username);
  // Calculate total storage
  let totalSize = 0;
  lib.forEach(t => { totalSize += (t.fileSize || 0); });
  res.json({ tracks: lib, totalSize });
});

// Stream a library track for in-app playback (supports Range for seeking)
app.get('/api/library/:id/stream', authMiddleware, (req, res) => {
  const { id } = req.params;
  const lib = readLibrary(req.username);
  const track = lib.find(t => t.id === id);

  if (!track) return res.status(404).json({ error: 'Track not found in library.' });

  const filePath = path.join(getUserLibraryDir(req.username), track.filename);
  if (!fs.existsSync(filePath)) {
    // File missing on disk — remove from library db
    removeFromLibrary(req.username, id);
    return res.status(404).json({ error: 'Audio file missing from disk. Removed from library.' });
  }

  let fileSize;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch (e) {
    return res.status(500).json({ error: 'Cannot read file.' });
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    if (start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Type', 'audio/mpeg');
    const rangeStream = fs.createReadStream(filePath, { start, end });
    rangeStream.on('error', (e) => {
      if (!res.headersSent) res.status(500).json({ error: 'Stream error.' });
      else res.destroy();
    });
    return rangeStream.pipe(res);
  }

  // Full stream (no range)
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
});

// Export / download a library track to PC
app.get('/api/library/:id/export', authMiddleware, (req, res) => {
  const { id } = req.params;
  const lib = readLibrary(req.username);
  const track = lib.find(t => t.id === id);

  if (!track) return res.status(404).json({ error: 'Track not found.' });

  const filePath = path.join(getUserLibraryDir(req.username), track.filename);
  if (!fs.existsSync(filePath)) {
    removeFromLibrary(req.username, id);
    return res.status(404).json({ error: 'File missing from disk.' });
  }

  const rawTitle = (track.title || 'audio').replace(/[^a-zA-Z0-9\s\-_()]/g, '').trim();
  const ext = path.extname(track.filename);
  const downloadName = `${rawTitle} - ${track.quality}${ext}`;
  const encodedName = encodeURIComponent(downloadName);
  const fileSize = fs.statSync(filePath).size;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Cache-Control', 'no-cache');

  fs.createReadStream(filePath).pipe(res);
});

// Delete a track from library
app.delete('/api/library/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const track = removeFromLibrary(req.username, id);

  if (!track) return res.status(404).json({ error: 'Track not found in library.' });

  // Delete file from disk
  const filePath = path.join(getUserLibraryDir(req.username), track.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.log(`[Library:${req.username}] Deleted: "${track.title}"`);
  } catch (e) {
    console.error(`[Library] Failed to delete file for ${id}:`, e.message);
  }

  res.json({ success: true, id });
});

// ----------------------------------------------------
// JOB PROCESSOR ENGINE (In-Memory Concurrency)
// ----------------------------------------------------

// Fixed: Run up to MAX_CONCURRENT_JOBS in parallel instead of blocking on one at a time
const MAX_CONCURRENT_JOBS = 5;
let activeJobCount = 0;

async function processQueue() {
  // Drain the queue up to the concurrency limit
  while (jobQueue.length > 0 && activeJobCount < MAX_CONCURRENT_JOBS) {
    const jobId = jobQueue.shift();
    const job = jobs.get(jobId);
    if (!job) continue;

    activeJobCount++;
    // Run each job independently (non-blocking)
    processJob(job)
      .catch((err) => {
        console.error(`[Queue] Job ${jobId} failed:`, err.message);
        job.status = 'error';
        job.error = err.message || 'Unknown extraction error';
      })
      .finally(() => {
        activeJobCount--;
        // Continue draining queue when a slot opens up
        processQueue();
      });
  }
}

// Real audio extraction using yt-dlp + ffmpeg
async function processJob(job) {
  console.log(`[yt-dlp] Starting job ${job.id} — "${job.title}" [${job.quality}]`);

  job.status = 'fetching';
  job.progress = 5;

  // Map quality string to bitrate number
  const bitrateMap = { '128kbps': '128', '192kbps': '192', '320kbps': '320' };
  const bitrate = bitrateMap[job.quality] || '192';

  // Determine if this is a video job
  const isVideo = job.type === 'video';

  // Output path — yt-dlp will write directly here
  const ext = isVideo ? 'mp4' : 'mp3';
  const outputPath = path.join(CACHE_DIR, `${job.id}.${ext}`);

  // Cookies support — helps bypass YouTube bot detection on cloud servers
  // Place a cookies.txt file in the project root, or set YTDLP_COOKIES env var
  const cookiesPath = process.env.YTDLP_COOKIES || path.join(__dirname, 'cookies.txt');
  const cookiesArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];
  if (cookiesArgs.length > 0) {
    console.log(`[yt-dlp] Using cookies file: ${cookiesPath}`);
  } else {
    console.warn('[yt-dlp] No cookies.txt found. YouTube may block requests. Add a cookies.txt file to fix this.');
  }

  // Build yt-dlp arguments
  // web_embedded + web clients with explicit node path for JS n-challenge solving.
  // This is the proven working combination. process.execPath gives the exact node
  // binary path on both Windows (node.exe) and Linux (/usr/bin/node etc.)
  const ytArgs = isVideo
    ? [
        '--no-playlist',
        '--ffmpeg-location', ffmpegPath,
        ...cookiesArgs,
        '--extractor-args', 'youtube:player_client=web_embedded,web',
        '--js-runtimes', `node:${process.execPath}`,
        '--no-check-certificates',
        '--retries', '3',
        '-f', 'bestvideo[ext=mp4]+bestaudio/bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        '--newline',
        '--progress',
        job.url
      ]
    : [
        '--no-playlist',
        '--ffmpeg-location', ffmpegPath,
        ...cookiesArgs,
        '--extractor-args', 'youtube:player_client=web_embedded,web',
        '--js-runtimes', `node:${process.execPath}`,
        '--no-check-certificates',
        '--retries', '3',
        '-x',                            // Extract audio only
        '--audio-format', 'mp3',
        '--audio-quality', bitrate + 'K',
        '--embed-thumbnail',             // Embed cover art
        '--add-metadata',                // Write ID3 tags
        '-o', outputPath,
        '--newline',
        '--progress',
        job.url
      ];

  console.log(`[yt-dlp] Command: ${YTDLP_PATH} ${ytArgs.join(' ')}`);


  await new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, ytArgs, { windowsHide: true });
    job._proc = proc; // Store reference for cancellation

    let stderr = '';

    // Parse yt-dlp's progress output to update job.progress
    // yt-dlp --newline outputs lines like: "[download]  45.3% of   5.23MiB at    1.20MiB/s"
    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        console.log(`[yt-dlp stdout] ${trimmed}`);

        // Detect download phase
        const dlMatch = trimmed.match(/\[download\]\s+([\d.]+)%/);
        if (dlMatch) {
          const pct = parseFloat(dlMatch[1]);
          if (job.status === 'fetching' || job.status === 'extracting') {
            // Map 0-100% download => 10-75% of total progress
            job.progress = Math.round(10 + pct * 0.65);
            job.status = 'extracting';
          }
        }

        // Detect ffmpeg transcoding phase
        if (trimmed.includes('[ExtractAudio]') || trimmed.includes('[Merger]') || trimmed.includes('[ffmpeg]')) {
          job.status = 'transcoding';
          job.progress = Math.max(job.progress, 80);
        }

        // Detect completion
        if (trimmed.includes('[download] 100%') || trimmed.includes('has already been downloaded')) {
          job.progress = 90;
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // ffmpeg outputs its progress to stderr — look for frame/time markers
      if (text.includes('time=')) {
        job.status = 'transcoding';
        job.progress = Math.max(job.progress, 85);
      }
      console.log(`[yt-dlp stderr] ${text.trim()}`);
    });

    proc.on('close', async (code) => {
      delete job._proc;

      // Auto-recovery for WinError 32 (file lock during rename by yt-dlp)
      if (code !== 0 && stderr.includes('WinError 32')) {
        const tempPath = outputPath.replace(/(\.[a-zA-Z0-9]+)$/, '.temp$1');
        if (fs.existsSync(tempPath)) {
          console.log(`[yt-dlp] WinError 32 detected. Attempting to recover ${tempPath}...`);
          for (let i = 0; i < 5; i++) {
            await sleep(1000);
            try {
              fs.renameSync(tempPath, outputPath);
              code = 0;
              console.log('[yt-dlp] Recovery successful!');
              break;
            } catch (e) {
              console.log(`[yt-dlp] Rename retry ${i + 1} failed.`);
            }
          }
        }
      }

      if (code === 0) {
        // Verify the output file was actually created
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          let finalPath = outputPath;
          if (job.type === 'audio') {
            try {
              // Save to user's personal library directory
              const userLibDir = getUserLibraryDir(job.userId);
              const libFilename = `${job.id}.mp3`;
              const libPath = path.join(userLibDir, libFilename);
              fs.copyFileSync(outputPath, libPath);
              const fileSize = fs.statSync(libPath).size;
              addToLibrary(job.userId, {
                id: job.id,
                title: job.title,
                source: job.source,
                sourceUrl: job.url,
                quality: job.quality,
                type: 'audio',
                duration: job.duration,
                thumbnail: job.thumbnail,
                filename: libFilename,
                fileSize: fileSize,
                addedAt: Date.now()
              });
              fs.unlinkSync(outputPath);
              finalPath = libPath;
              console.log(`[Library:${job.userId}] Track automatically saved to library: "${job.title}"`);
            } catch (libErr) {
              console.error(`[Library] Failed to automatically save to library for job ${job.id}:`, libErr.message);
            }
          }
          job.filePath = finalPath;
          job.progress = 100;
          job.status = 'ready';
          console.log(`[yt-dlp] Job ${job.id} completed. File: ${finalPath} (${fs.statSync(finalPath).size} bytes)`);
          resolve();
        } else {
          reject(new Error('yt-dlp exited successfully but output file is missing or empty.'));
        }
      } else {
        // Extract the most useful error line from stderr
        const errorLine = stderr.split('\n').filter(l => l.includes('ERROR') || l.includes('error')).pop()
          || `yt-dlp exited with code ${code}`;
        reject(new Error(errorLine.trim()));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------
// STORAGE MANAGEMENT (NFR-6.3 Auto-Purge Policy)
// ----------------------------------------------------
const PURGE_TIMEOUT_MS = 15 * 60 * 1000; // 15 Minutes

setInterval(() => {
  console.log('[Storage] Running automatic 15-minute purge cycle...');
  const now = Date.now();
  
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) {
      console.error('[Storage] Error reading cache directory:', err);
      return;
    }

    files.forEach(file => {
      // Skip files belonging to active (non-ready/non-error) jobs to avoid file locking (WinError 32) on Windows
      const jobIdMatch = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (jobIdMatch) {
        const jobId = jobIdMatch[1];
        const job = jobs.get(jobId);
        if (job && job.status !== 'ready' && job.status !== 'error') {
          return; // Skip active job file from purge scan
        }
      }

      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          // File might have been deleted/moved/renamed since readdir, safe to ignore
          return;
        }

        // Check if file is older than 15 minutes
        if (now - stats.mtimeMs > PURGE_TIMEOUT_MS) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`[Storage] Failed to purge file ${file}:`, unlinkErr);
            } else {
              console.log(`[Storage] Purged expired cache file: ${file}`);
              
              // Clean memory reference if present (handle both audio and video extensions)
              const ext = path.extname(file);
              const jobId = path.basename(file, ext);
              if (jobs.has(jobId)) {
                jobs.delete(jobId);
              }
            }
          });
        }
      });
    });
  });
}, 60 * 1000); // Check every 1 minute

// Start Express Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`SonicFetch Backend listening on http://localhost:${PORT}`);
  console.log(`Serving static UI files from ${PUBLIC_DIR}`);
  console.log(`Audio Cache directory configured at ${CACHE_DIR}`);
  console.log(`Per-user libraries stored under ${BASE_LIBRARY_DIR}/<username>/`);
  console.log(`=======================================================`);
});
