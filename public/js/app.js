/* ==========================================================================
   SonicFetch JavaScript controller
   Manages SPA transitions, URL validations, API communications, polling,
   Library management, Audio Player, and View Routing.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================================================
  // ELEMENT REFERENCES
  // ==========================================================================

  // Sidebar / Navigation
  const sidebar = document.getElementById('sidebar');
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const navFetchBtn = document.getElementById('nav-fetch');
  const navLibraryBtn = document.getElementById('nav-library');
  const libraryBadge = document.getElementById('library-badge');

  // Views
  const viewFetch = document.getElementById('view-fetch');
  const viewLibrary = document.getElementById('view-library');
  const allViews = [viewFetch, viewLibrary];

  // Fetch View Elements
  const urlInput = document.getElementById('url-input');
  const clearBtn = document.getElementById('clear-btn');
  const fetchForm = document.getElementById('fetch-form');
  const fetchBtn = document.getElementById('fetch-btn');
  const homeError = document.getElementById('home-error');
  
  const stateHome = document.getElementById('state-home');
  const stateProcessing = document.getElementById('state-processing');
  const stateOptions = document.getElementById('state-options');
  const stateDownload = document.getElementById('state-download');
  const states = [stateHome, stateProcessing, stateOptions, stateDownload];

  const previewThumbnail = document.getElementById('preview-thumbnail');
  const previewDuration = document.getElementById('preview-duration');
  const previewTitle = document.getElementById('preview-title');
  const previewSource = document.getElementById('preview-source');
  const backToInputBtn = document.getElementById('back-to-input');
  const convertBtn = document.getElementById('convert-btn');
  const formatCards = document.querySelectorAll('.format-card');
  const audioQualitySection = document.getElementById('audio-quality-section');

  const processingStatusText = document.getElementById('processing-status-text');

  const downloadIconContainer = document.getElementById('download-icon-container');
  const downloadStateTitle = document.getElementById('download-state-title');
  const downloadStateDesc = document.getElementById('download-state-desc');
  const progressStepText = document.getElementById('progress-step-text');
  const progressPercentageText = document.getElementById('progress-percentage-text');
  const progressFillBar = document.getElementById('progress-fill-bar');
  const trackDetailsReady = document.getElementById('track-details-ready');
  const readyTrackTitle = document.getElementById('ready-track-title');
  const readyTrackDesc = document.getElementById('ready-track-desc');
  const cancelConvertBtn = document.getElementById('cancel-convert-btn');
  const startDownloadBtn = document.getElementById('start-download-btn');
  const convertAnotherBtn = document.getElementById('convert-another-btn');

  // Library View Elements
  const libraryEmpty = document.getElementById('library-empty');
  const libraryTrackList = document.getElementById('library-track-list');
  const libraryTrackCount = document.getElementById('library-track-count');
  const libraryStorageUsed = document.getElementById('library-storage-used');
  const libraryGoFetchBtn = document.getElementById('library-go-fetch');

  // Mini Now-Playing (sidebar)
  const sidebarNowPlaying = document.getElementById('sidebar-now-playing');
  const miniArtImg = document.getElementById('mini-art-img');
  const miniTitle = document.getElementById('mini-title');
  const miniSource = document.getElementById('mini-source');
  const miniPlayBtn = document.getElementById('mini-play-btn');

  // Bottom Audio Player
  const audioPlayerBar = document.getElementById('audio-player-bar');
  const playerArtImg = document.getElementById('player-art-img');
  const playerTitle = document.getElementById('player-title');
  const playerSourceEl = document.getElementById('player-source');
  const playerPlayBtn = document.getElementById('player-play');
  const playerPrevBtn = document.getElementById('player-prev');
  const playerNextBtn = document.getElementById('player-next');
  const playerSeekInput = document.getElementById('player-seek-input');
  const playerSeekFill = document.getElementById('player-seek-fill');
  const playerTimeCurrent = document.getElementById('player-time-current');
  const playerTimeTotal = document.getElementById('player-time-total');
  const playerVolumeSlider = document.getElementById('player-volume-slider');
  const playerVolumeBtn = document.getElementById('player-volume-btn');
  const audioElement = document.getElementById('audio-element');
  const appShell = document.getElementById('app-shell');

  // ==========================================================================
  // APPLICATION STATE
  // ==========================================================================
  let fetchedMetadata = null;
  let activeJobId = null;
  let activeJobType = 'audio';
  let pollInterval = null;
  let processingTextInterval = null;

  // Library state
  let libraryTracks = [];
  let currentPlayingId = null;
  let currentPlayingIndex = -1;
  let isPlaying = false;

  // Initialize Lucide Icons
  lucide.createIcons();

  // ==========================================================================
  // VIEW ROUTER
  // ==========================================================================
  function switchView(viewName) {
    allViews.forEach(v => {
      v.classList.remove('active');
      v.style.display = 'none';
    });

    // Update nav active states
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));

    if (viewName === 'library') {
      viewLibrary.style.display = 'block';
      setTimeout(() => viewLibrary.classList.add('active'), 20);
      navLibraryBtn.classList.add('active');
      loadLibrary();
    } else {
      viewFetch.style.display = 'block';
      setTimeout(() => viewFetch.classList.add('active'), 20);
      navFetchBtn.classList.add('active');
    }

    // Close mobile sidebar
    closeSidebar();
  }

  navFetchBtn.addEventListener('click', () => switchView('fetch'));
  navLibraryBtn.addEventListener('click', () => switchView('library'));
  libraryGoFetchBtn.addEventListener('click', () => switchView('fetch'));

  // ==========================================================================
  // SIDEBAR (Mobile)
  // ==========================================================================
  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  }

  hamburgerBtn.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  sidebarOverlay.addEventListener('click', closeSidebar);

  // ==========================================================================
  // FETCH VIEW — URL INPUT & VALIDATION
  // ==========================================================================
  function transitionToState(targetState) {
    states.forEach(state => {
      if (state === targetState) {
        state.style.display = 'block';
        setTimeout(() => state.classList.add('active'), 50);
      } else {
        state.classList.remove('active');
        state.style.display = 'none';
      }
    });
  }

  urlInput.addEventListener('input', () => {
    const value = urlInput.value.trim();
    clearBtn.classList.toggle('hidden', value.length === 0);
    if (isValidHttpUrl(value)) {
      fetchBtn.removeAttribute('disabled');
      homeError.classList.add('hidden');
    } else {
      fetchBtn.setAttribute('disabled', 'true');
    }
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    clearBtn.classList.add('hidden');
    fetchBtn.setAttribute('disabled', 'true');
    homeError.classList.add('hidden');
    urlInput.focus();
  });

  function isValidHttpUrl(string) {
    try { const url = new URL(string); return url.protocol === "http:" || url.protocol === "https:"; }
    catch (_) { return false; }
  }

  // Format toggle handler
  formatCards.forEach(card => {
    card.addEventListener('change', () => {
      formatCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const selected = document.querySelector('input[name="download-format"]:checked').value;
      if (selected === 'video') {
        audioQualitySection.style.display = 'none';
        convertBtn.querySelector('span').textContent = 'Download Video';
        const icon = convertBtn.querySelector('.btn-icon');
        if (icon) icon.setAttribute('data-lucide', 'film');
      } else {
        audioQualitySection.style.display = '';
        convertBtn.querySelector('span').textContent = 'Extract Audio';
        const icon = convertBtn.querySelector('.btn-icon');
        if (icon) icon.setAttribute('data-lucide', 'cpu');
      }
      lucide.createIcons();
    });
  });

  // Fetch metadata
  fetchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    homeError.classList.add('hidden');
    transitionToState(stateProcessing);
    startProcessingTexts();
    try {
      const response = await fetch('/api/fetch-metadata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to analyze URL.');
      fetchedMetadata = data;
      fetchedMetadata.url = url;
      previewTitle.textContent = fetchedMetadata.title;
      previewThumbnail.src = fetchedMetadata.thumbnail;
      previewDuration.textContent = fetchedMetadata.duration;
      previewSource.querySelector('span').textContent = fetchedMetadata.source;
      const sourceIcon = previewSource.querySelector('i') || previewSource.querySelector('svg');
      let iconName = 'globe';
      const srcLower = fetchedMetadata.source.toLowerCase();
      if (srcLower.includes('youtube')) iconName = 'youtube';
      else if (srcLower.includes('soundcloud')) iconName = 'music';
      else if (srcLower.includes('bandcamp')) iconName = 'disc';
      else if (srcLower.includes('vimeo')) iconName = 'video';
      if (sourceIcon) { sourceIcon.setAttribute('data-lucide', iconName); }

      // Reset format toggle
      document.querySelector('input[name="download-format"][value="audio"]').checked = true;
      formatCards.forEach(c => c.classList.remove('active'));
      document.getElementById('format-card-audio').classList.add('active');
      audioQualitySection.style.display = '';
      convertBtn.querySelector('span').textContent = 'Extract Audio';
      const resetIcon = convertBtn.querySelector('.btn-icon');
      if (resetIcon) resetIcon.setAttribute('data-lucide', 'cpu');
      lucide.createIcons();

      stopProcessingTexts();
      transitionToState(stateOptions);
    } catch (err) {
      stopProcessingTexts();
      homeError.querySelector('.alert-message').textContent = err.message || 'An unexpected error occurred.';
      homeError.classList.remove('hidden');
      transitionToState(stateHome);
    }
  });

  backToInputBtn.addEventListener('click', () => transitionToState(stateHome));

  const qualityCards = document.querySelectorAll('.quality-card');
  qualityCards.forEach(card => {
    card.addEventListener('change', () => {
      qualityCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });
  });

  // ==========================================================================
  // FETCH VIEW — CONVERSION
  // ==========================================================================
  convertBtn.addEventListener('click', async () => {
    if (!fetchedMetadata) return;
    const selectedFormat = document.querySelector('input[name="download-format"]:checked').value;
    const isVideo = selectedFormat === 'video';
    activeJobType = selectedFormat;
    const selectedQuality = document.querySelector('input[name="audio-quality"]:checked').value;
    resetDownloadStateUI(isVideo);
    transitionToState(stateDownload);
    try {
      const body = {
        url: fetchedMetadata.url, type: selectedFormat,
        title: fetchedMetadata.title, thumbnail: fetchedMetadata.thumbnail,
        duration: fetchedMetadata.duration, source: fetchedMetadata.source
      };
      if (!isVideo) body.quality = selectedQuality;
      const response = await fetch('/api/convert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start conversion.');
      activeJobId = data.jobId;
      startStatusPolling(activeJobId, isVideo ? 'MP4' : selectedQuality, isVideo);
    } catch (err) {
      showConversionError(err.message || 'Failed to initiate converter.');
    }
  });

  function startStatusPolling(jobId, qualityLabel, isVideo) {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/status/${jobId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to poll status.');
        progressFillBar.style.width = `${data.progress}%`;
        progressPercentageText.textContent = `${data.progress}%`;
        let stepText = 'Processing...';
        switch (data.status) {
          case 'pending': stepText = isVideo ? 'Queueing video download...' : 'Queueing extraction job...'; break;
          case 'fetching': stepText = 'Connecting & downloading streams...'; break;
          case 'extracting': stepText = isVideo ? 'Downloading video & audio streams...' : 'Demuxing audio tracks...'; break;
          case 'transcoding': stepText = isVideo ? 'Merging streams into MP4...' : `Re-encoding to ${qualityLabel} MP3...`; break;
          case 'ready': stepText = isVideo ? 'Video ready!' : 'Conversion completed!'; break;
          case 'error': stepText = 'Error occurred.'; break;
        }
        progressStepText.textContent = stepText;
        if (data.status === 'ready') { clearInterval(pollInterval); showDownloadReady(jobId, data.title, qualityLabel, isVideo); }
        else if (data.status === 'error') { clearInterval(pollInterval); showConversionError(data.error || 'Process crashed.'); }
      } catch (err) { clearInterval(pollInterval); showConversionError(err.message || 'Lost connection.'); }
    }, 800);
  }

  function showDownloadReady(jobId, title, qualityLabel, isVideo) {
    downloadIconContainer.innerHTML = '<i data-lucide="check" class="process-icon" style="color: var(--success)"></i>';
    downloadIconContainer.style.borderColor = 'var(--success)';
    downloadIconContainer.style.boxShadow = '0 0 20px var(--success-glow)';
    downloadStateTitle.textContent = isVideo ? 'Video Ready!' : 'Conversion Successful!';
    downloadStateDesc.textContent = isVideo ? 'Your MP4 video file is ready for download.' : 'Your high-quality MP3 audio file is ready for download.';
    readyTrackTitle.textContent = title;
    readyTrackDesc.textContent = isVideo ? 'MP4 Video • Best quality' : `${qualityLabel} MP3`;
    trackDetailsReady.classList.remove('hidden');
    startDownloadBtn.classList.remove('hidden');
    convertAnotherBtn.classList.remove('hidden');
    cancelConvertBtn.classList.add('hidden');
    lucide.createIcons();

    // Load library immediately if audio so it displays in My Library
    if (!isVideo) {
      loadLibrary();
    }

    startDownloadBtn.onclick = () => {
      const endpoint = isVideo ? `/api/download-video/${jobId}` : `/api/download/${jobId}`;
      window.location.href = endpoint;
      startDownloadBtn.setAttribute('disabled', 'true');
      startDownloadBtn.querySelector('span').textContent = 'Downloaded';
      // Reload library after a short delay (server needs time to save)
      if (!isVideo) { setTimeout(() => loadLibrary(), 2000); }
    };
  }

  function showConversionError(errorMsg) {
    downloadIconContainer.innerHTML = '<i data-lucide="alert-triangle" class="process-icon" style="color: var(--error)"></i>';
    downloadIconContainer.style.borderColor = 'var(--error)';
    downloadIconContainer.style.boxShadow = '0 0 20px var(--error-glow)';
    const isVideo = activeJobType === 'video';
    downloadStateTitle.textContent = isVideo ? 'Download Failed' : 'Conversion Failed';
    downloadStateDesc.textContent = isVideo ? 'An error occurred during video download.' : 'An error occurred during audio transcoding.';
    progressStepText.textContent = errorMsg;
    progressPercentageText.textContent = 'Error';
    progressFillBar.style.backgroundColor = 'var(--error)';
    cancelConvertBtn.classList.add('hidden');
    convertAnotherBtn.classList.remove('hidden');
    lucide.createIcons();
  }

  function resetDownloadStateUI(isVideo) {
    downloadIconContainer.innerHTML = '<i data-lucide="cpu" class="process-icon animate-spin-slow"></i>';
    downloadIconContainer.style.borderColor = 'var(--border-color)';
    downloadIconContainer.style.boxShadow = 'var(--shadow-glow)';
    downloadStateTitle.textContent = isVideo ? 'Downloading Video' : 'Converting Audio';
    downloadStateDesc.textContent = isVideo ? 'Fetching video and audio streams...' : 'Transcoding media stream to selected format...';
    progressStepText.textContent = 'Initializing task...';
    progressPercentageText.textContent = '0%';
    progressFillBar.style.width = '0%';
    progressFillBar.style.backgroundColor = '';
    trackDetailsReady.classList.add('hidden');
    startDownloadBtn.classList.add('hidden');
    startDownloadBtn.removeAttribute('disabled');
    startDownloadBtn.querySelector('span').textContent = 'Download Now';
    cancelConvertBtn.classList.remove('hidden');
    convertAnotherBtn.classList.add('hidden');
    lucide.createIcons();
  }

  cancelConvertBtn.addEventListener('click', () => { if (pollInterval) clearInterval(pollInterval); transitionToState(stateOptions); });

  convertAnotherBtn.addEventListener('click', () => {
    urlInput.value = ''; clearBtn.classList.add('hidden');
    fetchBtn.setAttribute('disabled', 'true'); fetchedMetadata = null;
    activeJobId = null; activeJobType = 'audio';
    transitionToState(stateHome);
  });

  function startProcessingTexts() {
    const statuses = ['Connecting to the target server...', 'Validating source URL headers...', 'Bypassing server firewalls...', 'Scraping Open Graph page structures...', 'Extracting title and thumbnail media properties...', 'Finalizing configuration cards...'];
    let index = 0;
    processingStatusText.textContent = statuses[0];
    processingTextInterval = setInterval(() => { index = (index + 1) % statuses.length; processingStatusText.textContent = statuses[index]; }, 1500);
  }

  function stopProcessingTexts() {
    if (processingTextInterval) { clearInterval(processingTextInterval); processingTextInterval = null; }
  }

  // ==========================================================================
  // LIBRARY — DATA + RENDERING
  // ==========================================================================
  async function loadLibrary() {
    try {
      const response = await fetch(`/api/library?t=${Date.now()}`);
      const data = await response.json();
      libraryTracks = data.tracks || [];
      updateLibraryBadge();
      renderLibrary(data.totalSize);
    } catch (e) {
      console.error('Failed to load library:', e);
    }
  }

  function updateLibraryBadge() {
    if (libraryTracks.length > 0) {
      libraryBadge.textContent = libraryTracks.length;
      libraryBadge.classList.remove('hidden');
    } else {
      libraryBadge.classList.add('hidden');
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function renderLibrary(totalSize) {
    libraryTrackCount.textContent = `${libraryTracks.length} track${libraryTracks.length !== 1 ? 's' : ''}`;
    libraryStorageUsed.textContent = `${formatFileSize(totalSize || 0)} used`;

    if (libraryTracks.length === 0) {
      libraryEmpty.style.display = '';
      libraryTrackList.style.display = 'none';
      return;
    }

    libraryEmpty.style.display = 'none';
    libraryTrackList.style.display = '';
    libraryTrackList.innerHTML = '';

    libraryTracks.forEach((track, index) => {
      const isCurrentlyPlaying = currentPlayingId === track.id;
      const row = document.createElement('div');
      row.className = `lib-track-row${isCurrentlyPlaying ? ' playing' : ''}`;
      row.dataset.trackId = track.id;
      row.dataset.index = index;

      const fallbackThumb = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=100&auto=format&fit=crop';

      row.innerHTML = `
        <div class="lib-track-art" data-action="play" data-id="${track.id}" title="Play">
          <img src="${track.thumbnail || fallbackThumb}" alt="${track.title}" onerror="this.src='${fallbackThumb}'">
          <div class="lib-track-art-overlay">
            <i data-lucide="${isCurrentlyPlaying && isPlaying ? 'pause' : 'play'}" class="lib-track-play-icon"></i>
          </div>
        </div>
        <div class="lib-track-info">
          <div class="lib-track-title">${escapeHtml(track.title)}</div>
          <div class="lib-track-meta">
            <span>${track.source || 'Web'}</span>
            <span class="lib-track-meta-sep">•</span>
            <span>${track.quality || ''}</span>
            <span class="lib-track-meta-sep">•</span>
            <span>${formatFileSize(track.fileSize || 0)}</span>
          </div>
        </div>
        <span class="lib-track-duration">${track.duration || '—'}</span>
        <div class="lib-track-actions">
          <button class="lib-action-btn" data-action="export" data-id="${track.id}" title="Save to PC">
            <i data-lucide="hard-drive-download" class="lib-action-icon"></i>
          </button>
          <button class="lib-action-btn delete-btn" data-action="delete" data-id="${track.id}" title="Delete">
            <i data-lucide="trash-2" class="lib-action-icon"></i>
          </button>
        </div>
      `;

      libraryTrackList.appendChild(row);
    });

    lucide.createIcons();

    // Attach event listeners
    libraryTrackList.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        const action = el.dataset.action;
        const id = el.dataset.id;
        if (action === 'play') handlePlayTrack(id);
        else if (action === 'export') handleExportTrack(id);
        else if (action === 'delete') handleDeleteTrack(id);
      });
    });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ==========================================================================
  // LIBRARY — ACTIONS
  // ==========================================================================
  function handlePlayTrack(id) {
    const index = libraryTracks.findIndex(t => t.id === id);
    if (index === -1) return;

    // If clicking the same track, toggle play/pause
    if (currentPlayingId === id) {
      togglePlayPause();
      return;
    }

    playTrackByIndex(index);
  }

  function playTrackByIndex(index) {
    if (index < 0 || index >= libraryTracks.length) return;
    const track = libraryTracks[index];
    currentPlayingId = track.id;
    currentPlayingIndex = index;

    const fallbackThumb = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=100&auto=format&fit=crop';

    // Set audio source and play
    audioElement.src = `/api/library/${track.id}/stream`;
    audioElement.play().then(() => {
      isPlaying = true;
      updatePlayerUI(track);
      updateMiniPlayerUI(track);
      showPlayer();
      renderLibrary(); // re-render to highlight playing track
    }).catch(err => {
      console.error('Playback failed:', err);
    });
  }

  function togglePlayPause() {
    if (audioElement.paused) {
      audioElement.play();
      isPlaying = true;
    } else {
      audioElement.pause();
      isPlaying = false;
    }
    updatePlayIcons();
  }

  function handleExportTrack(id) {
    window.location.href = `/api/library/${id}/export`;
  }

  async function handleDeleteTrack(id) {
    const track = libraryTracks.find(t => t.id === id);
    if (!track) return;
    const confirmed = confirm(`Delete "${track.title}" from your library?\n\nThis will permanently remove the file.`);
    if (!confirmed) return;

    // If currently playing this track, stop playback
    if (currentPlayingId === id) {
      audioElement.pause();
      audioElement.src = '';
      currentPlayingId = null;
      currentPlayingIndex = -1;
      isPlaying = false;
      hidePlayer();
    }

    try {
      const response = await fetch(`/api/library/${id}`, { method: 'DELETE' });
      if (response.ok) {
        await loadLibrary();
      }
    } catch (e) {
      console.error('Delete failed:', e);
    }
  }

  // ==========================================================================
  // AUDIO PLAYER
  // ==========================================================================
  function showPlayer() {
    audioPlayerBar.classList.remove('hidden');
    appShell.classList.add('player-active');
    sidebarNowPlaying.classList.remove('hidden');
  }

  function hidePlayer() {
    audioPlayerBar.classList.add('hidden');
    appShell.classList.remove('player-active');
    sidebarNowPlaying.classList.add('hidden');
  }

  function updatePlayerUI(track) {
    const fallbackThumb = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=100&auto=format&fit=crop';
    playerArtImg.src = track.thumbnail || fallbackThumb;
    playerTitle.textContent = track.title;
    playerSourceEl.textContent = `${track.source || 'Web'} • ${track.quality || ''}`;
    updatePlayIcons();
  }

  function updateMiniPlayerUI(track) {
    const fallbackThumb = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=100&auto=format&fit=crop';
    miniArtImg.src = track.thumbnail || fallbackThumb;
    miniTitle.textContent = track.title;
    miniSource.textContent = track.source || 'Web';
  }

  function updatePlayIcons() {
    // Update bottom player play button icon
    const playIcon = playerPlayBtn.querySelector('svg, i');
    if (playIcon) playIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');

    // Update mini player button
    const miniIcon = miniPlayBtn.querySelector('svg, i');
    if (miniIcon) miniIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');

    lucide.createIcons();

    // Update track list play overlays
    document.querySelectorAll('.lib-track-row').forEach(row => {
      const id = row.dataset.trackId;
      const overlayIcon = row.querySelector('.lib-track-play-icon');
      if (overlayIcon) {
        if (id === currentPlayingId) {
          row.classList.add('playing');
          overlayIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
        } else {
          row.classList.remove('playing');
          overlayIcon.setAttribute('data-lucide', 'play');
        }
      }
    });
    lucide.createIcons();
  }

  function formatTime(secs) {
    if (isNaN(secs) || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Player controls
  playerPlayBtn.addEventListener('click', togglePlayPause);
  miniPlayBtn.addEventListener('click', togglePlayPause);

  playerPrevBtn.addEventListener('click', () => {
    if (libraryTracks.length === 0) return;
    let newIndex = currentPlayingIndex - 1;
    if (newIndex < 0) newIndex = libraryTracks.length - 1;
    playTrackByIndex(newIndex);
  });

  playerNextBtn.addEventListener('click', () => {
    if (libraryTracks.length === 0) return;
    let newIndex = currentPlayingIndex + 1;
    if (newIndex >= libraryTracks.length) newIndex = 0;
    playTrackByIndex(newIndex);
  });

  // Seek
  playerSeekInput.addEventListener('input', () => {
    if (audioElement.duration) {
      audioElement.currentTime = (playerSeekInput.value / 100) * audioElement.duration;
    }
  });

  // Volume
  playerVolumeSlider.addEventListener('input', () => {
    audioElement.volume = playerVolumeSlider.value / 100;
    updateVolumeIcon();
  });

  playerVolumeBtn.addEventListener('click', () => {
    audioElement.muted = !audioElement.muted;
    updateVolumeIcon();
  });

  function updateVolumeIcon() {
    const icon = playerVolumeBtn.querySelector('svg, i');
    if (!icon) return;
    if (audioElement.muted || audioElement.volume === 0) {
      icon.setAttribute('data-lucide', 'volume-x');
    } else if (audioElement.volume < 0.5) {
      icon.setAttribute('data-lucide', 'volume-1');
    } else {
      icon.setAttribute('data-lucide', 'volume-2');
    }
    lucide.createIcons();
  }

  // Audio element events
  audioElement.addEventListener('timeupdate', () => {
    if (!audioElement.duration) return;
    const pct = (audioElement.currentTime / audioElement.duration) * 100;
    playerSeekFill.style.width = `${pct}%`;
    playerSeekInput.value = pct;
    playerTimeCurrent.textContent = formatTime(audioElement.currentTime);
  });

  audioElement.addEventListener('loadedmetadata', () => {
    playerTimeTotal.textContent = formatTime(audioElement.duration);
  });

  audioElement.addEventListener('ended', () => {
    // Auto-play next
    if (libraryTracks.length > 0) {
      let nextIndex = currentPlayingIndex + 1;
      if (nextIndex >= libraryTracks.length) nextIndex = 0;
      playTrackByIndex(nextIndex);
    }
  });

  audioElement.addEventListener('play', () => { isPlaying = true; updatePlayIcons(); });
  audioElement.addEventListener('pause', () => { isPlaying = false; updatePlayIcons(); });

  // Set initial volume
  audioElement.volume = 0.8;

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  loadLibrary(); // Load badge count on startup
});
