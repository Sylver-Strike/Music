const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

async function install() {
  if (process.platform === 'win32') {
    console.log('Windows detected. Skipping Linux yt-dlp binary download.');
    return;
  }

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

install();
