// Main UI + worker wiring
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const thumbs = document.getElementById('fileList');
const stitchBtn = document.getElementById('combineBtn');
const clearBtn = document.getElementById('clearBtn') || null;
const downloadBtn1 = document.getElementById('downloadLink1');
const downloadLink1 = document.getElementById('downloadLink1');
const downloadBtn = document.getElementById('downloadLink');
const downloadLink = document.getElementById('downloadLink');
const summary = document.getElementById('summary') || document.getElementById('status');
const limits = document.getElementById('limits') || document.getElementById('status');
const progressLoad = document.getElementById('progressLoad') || document.getElementById('status');
const progressDraw = document.getElementById('progressDraw') || document.getElementById('status');
const barLoad = document.getElementById('barLoad');
const barDraw = document.getElementById('barDraw');
const loadPct = document.getElementById('loadPct');
const drawPct = document.getElementById('drawPct');
const resultSection = document.getElementById('result') || document.getElementById('resultCanvas').parentElement;
const finalImg = document.getElementById('resultCanvas');
const safeModeEl = document.getElementById('safeMode') || { checked: false };
const rowsPerBandEl = document.getElementById('rowsPerBand') || { value: 8 };

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
    if (summary) summary.textContent = count ? `Selected ${count} file(s) • ${formatBytes(total)}` : '';
}

function resetUI() {
    selectedFiles = [];
    thumbs.innerHTML = '';
    updateSummary();
    if (limits) limits.textContent = '';
    if (downloadLink) downloadLink.dataset.ref = '';
    if (downloadLink1) downloadLink1.dataset.ref = '';
    if (resultSection) resultSection.hidden = true;
    if (downloadBtn) downloadBtn.disabled = true;
    if (downloadBtn1) downloadBtn1.disabled = true;
    if (stitchBtn) stitchBtn.disabled = true;
    if (progressLoad) progressLoad.hidden = true;
    if (progressDraw) progressDraw.hidden = true;
    if (finalImg) finalImg.src = '';
    if (worker) { worker.terminate(); worker = null; }
}

resetUI();

// Drag & drop + file input
dropZone.addEventListener('click', () => fileInput.click());

['dragenter', 'dragover'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('hover'); })
);
['dragleave', 'drop'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('hover'); })
);
dropZone.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    handleFiles(files);
});
fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

function handleFiles(files) {
    selectedFiles.push(...files);
    renderThumbs();
    updateSummary();
    stitchBtn.disabled = selectedFiles.length === 0;
}

function renderThumbs() {
    thumbs.innerHTML = '';
    for (const f of selectedFiles) {
        const d = document.createElement('div');
        d.className = 'thumb';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        img.className = "thumb";
        const label = document.createElement('div');
        label.textContent = f.name;
        label.style.fontSize = '12px';
        label.style.color = 'var(--muted, #aaa)';
        d.appendChild(img); d.appendChild(label);
        thumbs.appendChild(d);
    }
}

// Combine button
stitchBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return alert('Add image files first.');
    if (progressLoad) progressLoad.hidden = false;
    if (progressDraw) progressDraw.hidden = true;

    const arr = selectedFiles.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));

    if (worker) worker.terminate();
    worker = new Worker('worker.js');

    worker.onmessage = async (ev) => {
        const { type, data } = ev.data;
        switch (type) {
            case 'progress':
                if (progressBarSet) progressBarSet(barLoad, loadPct, data, 100);
                break;
            case 'ready':
                if (progressLoad) progressLoad.hidden = true;
                if (progressDraw) progressDraw.hidden = false;
                if (progressBarSet) progressBarSet(barDraw, drawPct, 0, 100);
                if (!data.offscreenAvailable && limits) limits.textContent = 'OffscreenCanvas not supported — using main-thread fallback.';
                break;
            case 'drawProgress':
                if (progressBarSet) progressBarSet(barDraw, drawPct, data, 100);
                break;
            case 'done':
                const blob = data;
                const url = URL.createObjectURL(blob);
                showResult(url);
                arr.forEach(i => URL.revokeObjectURL(i.url));
                worker.terminate(); worker = null;
                break;
            case 'fallback':
                progressLoad.hidden = true;
                await drawFallback(data);
                arr.forEach(i => URL.revokeObjectURL(i.url));
                worker.terminate(); worker = null;
                break;
            case 'error':
                alert('Worker error: ' + data);
                worker.terminate(); worker = null;
                break;
        }
    };

    worker.postMessage({
        action: 'start',
        images: arr,
        safeMode: safeModeEl.checked,
        rowsPerBand: Math.max(1, Number(rowsPerBandEl.value) || 8)
    });
});

// Clear button
if (clearBtn) clearBtn.addEventListener('click', () => { resetUI(); fileInput.value = ''; });

// Download helper
var download = (ev) => {
    const href = ev.currentTarget.dataset.ref;
    if (!href) return;
    const a = document.createElement('a'); a.href = href; a.download = 'combined.png'; a.click();
    a.remove();
}

if (downloadBtn) downloadBtn.addEventListener('click', download);
if (downloadBtn1) downloadBtn1.addEventListener('click', download);

function progressBarSet(barEl, pctEl, value, total) {
    if (!barEl || !pctEl) return;
    const pct = total ? Math.round((value / total) * 100) : 0;
    pctEl.textContent = pct + '%';
    barEl.style.width = pct + '%';
}

// fallback drawing on main thread
async function drawFallback(info) {
    const { coords, tileWidth, tileHeight, minX, minY, gridWidth, gridHeight } = info;
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
        await new Promise(r => setTimeout(r, 0));
    }

    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    showResult(url);
}

function showResult(url) {
    thumbs.innerHTML = '';
    if (progressDraw) progressDraw.hidden = true;
    resultSection.hidden = false;
    finalImg.src = url;
    downloadLink1.dataset.ref = url;
    downloadBtn1.disabled = false;
    downloadLink.dataset.ref = url;
    downloadBtn.disabled = false;
}

function ensureCanvasOK(w, h) {
    const MAX_DIM = 32767;
    const MAX_PIXELS = 268435456;
    if (w > MAX_DIM || h > MAX_DIM) throw new Error(`Canvas too large: ${w}×${h} exceeds max dimension ${MAX_DIM}.`);
    if (w * h > MAX_PIXELS) throw new Error(`Canvas too many pixels: ${w}×${h} = ${(w * h).toLocaleString()} px.`);
}
