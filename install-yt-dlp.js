const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

async function installYtDlp() {
  const binDir = path.join(__dirname, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const dest = path.join(binDir, 'yt-dlp');

  // Always download fresh to ensure we have the latest version
  // (avoids caching an outdated binary that YouTube blocks)
  // NOTE: Use yt-dlp_linux (standalone PyInstaller binary) — NOT plain 'yt-dlp' which is a Python script requiring python3
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  console.log(`Downloading latest Linux yt-dlp standalone binary from ${url}...`);
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log('Successfully downloaded yt-dlp Linux binary.');
    // Make it executable
    execSync(`chmod +x "${dest}"`);
    console.log('Set executable permissions on yt-dlp binary.');

    // Print the version so we can verify in Railway / Render logs
    try {
      const version = execSync(`"${dest}" --version`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
      console.log(`[yt-dlp] Installed version: ${version}`);
    } catch (e) {
      console.warn(`[yt-dlp] Warning: version check failed: ${e.message}`);
    }

  } catch (err) {
    console.error('Failed to download yt-dlp Linux binary:', err.message);
    console.log('Fallback: Will try to use global system "yt-dlp" command instead.');
  }
}

function installFfmpeg() {
  // Check if ffmpeg is already available
  try {
    const ver = execSync('ffmpeg -version', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().split('\n')[0].trim();
    console.log(`[ffmpeg] Already available: ${ver}`);
    return;
  } catch (e) {
    console.log('[ffmpeg] Not found in PATH. Attempting to install via apt-get...');
  }

  // Try apt-get install (works on Railway, Render Debian containers)
  try {
    execSync('apt-get update -qq && apt-get install -y -qq ffmpeg', { stdio: 'inherit' });
    console.log('[ffmpeg] Installed via apt-get successfully.');
  } catch (aptErr) {
    console.warn(`[ffmpeg] apt-get install failed: ${aptErr.message}`);
    console.warn('[ffmpeg] FFmpeg is not available. Audio extraction will fail. Make sure your deployment platform provides ffmpeg.');
  }
}

async function install() {
  if (process.platform === 'win32') {
    console.log('Windows detected. Skipping Linux binary downloads.');
    return;
  }

  await installYtDlp();
  installFfmpeg();
}

install();
