// worker.js - runs in a worker context
self.onmessage = async (ev) => {
  const { action, images, safeMode, rowsPerBand } = ev.data;
  if(action !== 'start') return;
  try {
    // parse coords
    const coords = [];
    for(const it of images){
      const base = it.name.replace(/\.[^/.]+$/,'');
      const parts = base.split(',');
      if(parts.length!==2) continue;
      const x = Number(parts[0]), y = Number(parts[1]);
      if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
      coords.push({ x, y, url: it.url });
    }
    if(coords.length===0){
      self.postMessage({ type:'error', data:'No valid x,y named files.'});
      return;
    }

    // decode first image to learn tile size via fetch+createImageBitmap
    const firstBlob = await (await fetch(coords[0].url)).blob();
    const firstBitmap = await createImageBitmap(firstBlob);
    const tileWidth = firstBitmap.width;
    const tileHeight = firstBitmap.height;
    firstBitmap.close();

    const minX = Math.min(...coords.map(c=>c.x));
    const maxX = Math.max(...coords.map(c=>c.x));
    const minY = Math.min(...coords.map(c=>c.y));
    const maxY = Math.max(...coords.map(c=>c.y));

    const gridWidth = (maxX - minX + 1) * tileWidth;
    const gridHeight = (maxY - minY + 1) * tileHeight;

    // quick limit check
    const MAX_DIM = 32767;
    const MAX_PIXELS = 268435456;
    if(gridWidth>MAX_DIM || gridHeight>MAX_DIM){
      self.postMessage({ type:'error', data:`Target canvas too large: ${gridWidth}×${gridHeight}.`});
      return;
    }
    if(gridWidth*gridHeight > MAX_PIXELS){
      self.postMessage({ type:'error', data:`Target pixels too many: ${gridWidth*gridHeight}.`});
      return;
    }

    // notify main that worker is ready and whether OffscreenCanvas is available
    const offscreenAvailable = typeof OffscreenCanvas !== 'undefined';
    self.postMessage({ type:'ready', data:{ offscreenAvailable } });

    // If OffscreenCanvas exists, do drawing here
    if(offscreenAvailable){
      const off = new OffscreenCanvas(gridWidth, gridHeight);
      const ctx = off.getContext('2d');

      let processed = 0;
      // Optionally use safeMode to draw by bands (reduce intermediate memory)
      if(!safeMode){
        for(const c of coords){
          const blob = await (await fetch(c.url)).blob();
          const bmp = await createImageBitmap(blob);
          ctx.drawImage(bmp, (c.x - minX)*tileWidth, (c.y - minY)*tileHeight);
          bmp.close();
          processed++;
          self.postMessage({ type:'drawProgress', data: Math.round((processed/coords.length)*100) });
        }
      } else {
        // draw in bands of rows to reduce working set
        const rows = maxY - minY + 1;
        for(let bandStart=0; bandStart<rows; bandStart+=rowsPerBand){
          const bandEnd = Math.min(rows, bandStart + rowsPerBand);
          for(const c of coords){
            const row = c.y - minY;
            if(row < bandStart || row >= bandEnd) continue;
            const blob = await (await fetch(c.url)).blob();
            const bmp = await createImageBitmap(blob);
            ctx.drawImage(bmp, (c.x - minX)*tileWidth, (row)*tileHeight);
            bmp.close();
            processed++;
            self.postMessage({ type:'drawProgress', data: Math.round((processed/coords.length)*100) });
          }
          // yield a tick to let browser breathe
          await new Promise(r => setTimeout(r,0));
        }
      }

      const blob = await off.convertToBlob({ type:'image/png' });
      self.postMessage({ type:'done', data: blob });
      return;
    }

    // If we get here OffscreenCanvas not available — tell main to fallback and provide metadata
    // For main-thread fallback, provide coords and layout (main thread will load images)
    self.postMessage({
      type: 'fallback',
      data: { coords, tileWidth, tileHeight, minX, minY, gridWidth, gridHeight }
    });
  } catch(err){
    self.postMessage({ type:'error', data: err.message || String(err) });
  }
};
