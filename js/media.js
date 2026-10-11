// Prepares photos and videos for posting: photos are resized, videos are checked.

const PHOTO_MAX = 1600;
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

// Videos are posted as they are, sound included; this just checks they can play and fit the length limit.
export async function processVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = true;
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('This video format is not supported by your browser. Try an MP4.'));
    });
    await resolveDuration(video);
    if (video.duration > MAX_VIDEO_SECONDS + 0.5) throw new Error(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds long.`);
    return { blob: file, type: 'video', width: video.videoWidth, height: video.videoHeight, report: {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}
