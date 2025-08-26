# JourneyMap Combiner (Client-side)

This tool stitches many tile images from the Minecraft Mod "JourneyMap" named `x,y.png` into one large image entirely in the browser.

### INSTANT AVAILABLE HERE: [JourneyMap Combiner](https://th3c0d3r.github.io/journeymap-combiner/)

## Features
- Drag & drop or file picker
- Thumbnail preview
- Web Worker with OffscreenCanvas for non-blocking stitching
- Fallback to main-thread drawing when OffscreenCanvas is not available
- Safe-mode (draw rows in bands) to reduce peak memory pressure

## Browser notes
- Best experience in Chromium-based browsers or modern Firefox.
- Very large final images may exceed browser canvas limits (~32k × 32k).
- Use "Safe mode" for many tiles to reduce memory spikes.

## License
MIT
