// Prepares photos and videos for posting: photos are resized, and video sound can be kept,
// voice-filtered, or removed.

const PHOTO_MAX = 1600;
const VIDEO_MAX = 720;
export const MAX_VIDEO_SECONDS = 60;

function fit(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  // even dimensions keep video encoders happy
  return [Math.max(2, Math.round(w * s / 2) * 2), Math.max(2, Math.round(h * s / 2) * 2)];
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image format is not supported by your browser. Try a JPG or PNG.')); };
    img.src = url;
  });
}

export async function processPhoto(file, { max = PHOTO_MAX } = {}) {
  const img = await loadImage(file);
  const [w, h] = fit(img.naturalWidth, img.naturalHeight, max);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
  return { blob, type: 'image', width: w, height: h, report: {} };
}

function pickMime() {
  const options = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find(t => window.MediaRecorder?.isTypeSupported(t)) || '';
}

// Experimental: carve out the main speech bands. It reduces voices but can also muffle barks and meows.
function voiceFilter(ac, input) {
  let node = input;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
  node.connect(hp); node = hp;
  for (const [f, q, g] of [[140, 1.2, -24], [220, 1.2, -24], [500, 1, -18], [1000, 1, -20], [2000, 1, -18], [3000, 1.2, -14]]) {
    const pk = ac.createBiquadFilter();
    pk.type = 'peaking'; pk.frequency.value = f; pk.Q.value = q; pk.gain.value = g;
    node.connect(pk); node = pk;
  }
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -30; comp.ratio.value = 6;
  node.connect(comp);
  const gain = ac.createGain(); gain.gain.value = 1.6;
  comp.connect(gain);
  return gain;
}

// Browser-recorded videos (webm) often report an Infinity duration until you seek to the end.
async function resolveDuration(video) {
  if (Number.isFinite(video.duration)) return;
  await new Promise(resolve => {
    const done = () => { video.removeEventListener('durationchange', check); resolve(); };
    const check = () => Number.isFinite(video.duration) && done();
    video.addEventListener('durationchange', check);
    video.currentTime = 1e7;
    setTimeout(done, 3000);
  });
  video.currentTime = 0;
  await new Promise(r => { video.onseeked = r; setTimeout(r, 1000); });
}

/** @param {{ audio?: 'keep'|'filter'|'remove', onProgress?: (f:number)=>void }} opts */
export async function processVideo(file, { audio = 'keep', onProgress } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('This video format is not supported by your browser. Try an MP4.'));
  });
  await resolveDuration(video);
  if (video.duration > MAX_VIDEO_SECONDS + 0.5) {
    URL.revokeObjectURL(url);
    throw new Error(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds long.`);
  }

  // Keeping the sound means nothing needs to change: post the original file.
  if (audio === 'keep') {
    URL.revokeObjectURL(url);
    onProgress?.(1);
    return { blob: file, type: 'video', width: video.videoWidth, height: video.videoHeight, report: { audio: 'kept' } };
  }

  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    URL.revokeObjectURL(url);
    throw new Error('This browser cannot change video sound. Try a recent Chrome, Edge or Safari, or keep the sound.');
  }

  const [w, h] = fit(video.videoWidth, video.videoHeight, VIDEO_MAX);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const frame = () => ctx.drawImage(video, 0, 0, w, h);
  frame();
  const stream = canvas.captureStream(30);

  let audioResult = 'removed';
  let ac = null;
  if (audio === 'filter') {
    try {
      ac = new AudioContext();
      const src = ac.createMediaElementSource(video); // also stops it playing through the speakers
      const dest = ac.createMediaStreamDestination();
      voiceFilter(ac, src).connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      await ac.resume();
      audioResult = 'filtered';
    } catch (err) {
      console.warn('Voice filter unavailable, removing sound', err);
      ac?.close();
      ac = null;
    }
  }
  video.muted = audioResult === 'removed';

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => (recorder.onstop = r));

  let running = true;
  const schedule = () => {
    if (!running) return;
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };
  const tick = () => {
    if (!running) return;
    frame();
    onProgress?.(Math.min(1, video.currentTime / video.duration));
    schedule();
  };

  recorder.start(250);
  const ended = new Promise(r => (video.onended = r));
  try {
    await video.play();
  } catch (err) {
    if (!video.ended && err.name !== 'AbortError') {
      video.muted = true;
      audioResult = 'removed';
      await video.play().catch(e => { if (!video.ended) throw e; });
    }
  }
  schedule();
  await ended;
  running = false;
  frame();
  await new Promise(r => setTimeout(r, 150));
  recorder.stop();
  await stopped;

  stream.getTracks().forEach(t => t.stop());
  ac?.close();
  URL.revokeObjectURL(url);
  onProgress?.(1);

  const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
  return { blob, type: 'video', width: w, height: h, report: { audio: audioResult } };
}
