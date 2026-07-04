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
  if (fs.existsSync(dest)) {
    console.log('yt-dlp Linux binary already exists at', dest);
    try {
      execSync(`chmod +x "${dest}"`);
    } catch (e) {}
    return;
  }

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  console.log(`Downloading latest Linux yt-dlp binary from ${url}...`);
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
  } catch (err) {
    console.error('Failed to download yt-dlp Linux binary:', err.message);
    console.log('Fallback: Will try to use global system "yt-dlp" command instead.');
  }
}

install();
