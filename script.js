// Main UI + worker wiring
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const thumbs = document.getElementById('thumbs');
const stitchBtn = document.getElementById('stitchBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadLink = document.getElementById('downloadLink');
const summary = document.getElementById('summary');
const limits = document.getElementById('limits');
const progressLoad = document.getElementById('progressLoad');
const progressDraw = document.getElementById('progressDraw');
const barLoad = document.getElementById('barLoad');
const barDraw = document.getElementById('barDraw');
const loadPct = document.getElementById('loadPct');
const drawPct = document.getElementById('drawPct');
const resultSection = document.getElementById('result');
const finalImg = document.getElementById('finalImg');
const safeModeEl = document.getElementById('safeMode');
const rowsPerBandEl = document.getElementById('rowsPerBand');

let selectedFiles = [];
let worker = null;

function parseXY(name) {
    const base = name.replace(/\.[^/.]+$/, '');
    const parts = base.split(',');
    if (parts.length !== 2) return null;
    const x = Number(parts[0]), y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}
function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function updateSummary() {
    const count = selectedFiles.length;
    const total = selectedFiles.reduce((s, f) => s + f.size, 0);
    summary.textContent = count ? `Selected ${count} file(s) • ${formatBytes(total)}` : '';
}

function resetUI() {
    selectedFiles = [];
    thumbs.innerHTML = '';
    updateSummary();
    limits.textContent = '';
    downloadLink.dataset.ref = '';
    resultSection.hidden = true;
    downloadBtn.disabled = true;
    stitchBtn.disabled = true;
    progressLoad.hidden = true;
    progressDraw.hidden = true;
    finalImg.src = '';
    if (worker) { worker.terminate(); worker = null; }
}

resetUI();

// drag & drop + file input
dropzone.addEventListener('click', () => fileInput.click());
['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files].filter(f => f.type === 'image/png');
    handleFiles(files);
});
fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

function handleFiles(files) {
    // append
    for (const f of files) selectedFiles.push(f);
    renderThumbs();
    updateSummary();
    stitchBtn.disabled = selectedFiles.length === 0;
}

function renderThumbs() {
    thumbs.innerHTML = '';
    for (const f of selectedFiles) {
        const d = document.createElement('div'); d.className = 'thumb';
        const img = document.createElement('img'); img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        const label = document.createElement('div'); label.textContent = f.name; label.style.fontSize = '12px'; label.style.color = 'var(--muted)';
        d.appendChild(img); d.appendChild(label);
        thumbs.appendChild(d);
    }
}

// stitch button
stitchBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return alert('Add PNG files first.');
    progressLoad.hidden = false; progressDraw.hidden = true;
    progressBarSet(barLoad, loadPct, 0, 100);
    // prepare array of {name, url}
    const arr = selectedFiles.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));
    // start worker
    if (worker) worker.terminate();
    worker = new Worker('worker.js');
    worker.onmessage = async (ev) => {
        const { type, data } = ev.data;
        if (type === 'progress') {
            progressBarSet(barLoad, loadPct, data, 100);
        } else if (type === 'ready') {
            // worker finished loading images and decided whether to use offscreen
            progressLoad.hidden = true;
            if (data.offscreenAvailable) {
                // worker will proceed to draw; show draw progress and forward values
                progressDraw.hidden = false; progressBarSet(barDraw, drawPct, 0, 100);
            } else {
                // fallback: we must draw on main thread
                progressDraw.hidden = false; progressBarSet(barDraw, drawPct, 0, 100);
                limits.textContent = 'OffscreenCanvas not supported in this browser — using main-thread fallback.';
            }
        } else if (type === 'drawProgress') {
            progressBarSet(barDraw, drawPct, data, 100);
        } else if (type === 'done') {
            // data is a Blob (PNG)
            const blob = data;
            const url = URL.createObjectURL(blob);
            showResult(url);
            // revoke uploaded object URLs
            for (const i of arr) URL.revokeObjectURL(i.url);
            // worker stays alive (or we can terminate)
            worker.terminate(); worker = null;
        } else if (type === 'fallback') {
            // Worker cannot draw in worker; provided layout metadata -> main thread draws
            progressLoad.hidden = true;
            const info = data; // { coords, tileWidth,.. }
            await drawFallback(info);
            // revoke uploaded object URLs
            for (const i of arr) URL.revokeObjectURL(i.url);
            worker.terminate(); worker = null;
        } else if (type === 'error') {
            alert('Worker error: ' + data);
            worker.terminate(); worker = null;
        }
    };

    // send start message (safeMode and rowsPerBand passed to worker)
    worker.postMessage({ action: 'start', images: arr, safeMode: safeModeEl.checked, rowsPerBand: Math.max(1, Number(rowsPerBandEl.value) || 8) });
});

// clear
clearBtn.addEventListener('click', () => { resetUI(); fileInput.value = ''; });

// download helper
downloadBtn.addEventListener('click', () => {
    const href = downloadLink.dataset.ref;
    if (!href) return;
    const a = document.createElement('a'); a.href = href; a.download = 'stitched.png'; a.click();
    a.remove();
});

function progressBarSet(barEl, pctEl, value, total) {
    const pct = total ? Math.round((value / total) * 100) : 0;
    pctEl.textContent = pct + '%';
    barEl.style.width = pct + '%';
}

// fallback drawing on main thread
async function drawFallback(info) {
    // info contains coords array with url + x,y and layout info
    const { coords, tileWidth, tileHeight, minX, minY, gridWidth, gridHeight } = info;
    // basic safety checks
    ensureCanvasOK(gridWidth, gridHeight);
    progressDraw.hidden = false;
    progressBarSet(barDraw, drawPct, 0, 100);

    // draw on normal canvas
    const canvas = document.createElement('canvas');
    canvas.width = gridWidth; canvas.height = gridHeight;
    const ctx = canvas.getContext('2d');

    let processed = 0;
    for (const c of coords) {
        await new Promise((res, rej) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { ctx.drawImage(img, (c.x - minX) * tileWidth, (c.y - minY) * tileHeight); res(); };
            img.onerror = rej;
            img.src = c.url;
        });
        processed++;
        progressBarSet(barDraw, drawPct, processed, coords.length);
        await new Promise(r => setTimeout(r, 0)); // yield
    }

    // convert canvas to blob and show
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    showResult(url);
}

// show result in UI
function showResult(url) {
    resultSection.hidden = false;
    finalImg.src = url;
    downloadLink.dataset.ref = url;
    downloadBtn.disabled = false;
    // release previews memory (thumb objectURLs were revoked on load)
}

// safety check for canvas limits
function ensureCanvasOK(w, h) {
    const MAX_DIM = 32767;
    const MAX_PIXELS = 268435456;
    if (w > MAX_DIM || h > MAX_DIM) throw new Error(`Canvas too large: ${w}×${h} exceeds max dimension ${MAX_DIM}.`);
    if (w * h > MAX_PIXELS) throw new Error(`Canvas too many pixels: ${w}×${h} = ${(w * h).toLocaleString()} px.`);
}
