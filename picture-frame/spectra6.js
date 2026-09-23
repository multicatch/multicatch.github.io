// Default Spectra 6 7.3" screen dimensions
const WIDTH = 800;
const HEIGHT = 480;

const REAL_PALETTE = [
    [25, 30, 33],       // black
    [232, 232, 232],    // white
    [239, 222, 68],     // yellow
    [178, 19, 24],      // red
    [33, 87, 186],      // blue
    [18, 95, 32],       // green
];

const DEVICE_PALETTE = [
    [0, 0, 0],          // black
    [255, 255, 255],    // white
    [255, 255, 0],      // yellow
    [255, 0, 0],        // red
    [0, 0, 255],       // blue
    [0, 255, 0],        // green
];

const DEVICE_INDEX_TO_RAW = [
    0x0, // black
    0x1, // white
    0x5, // yellow
    0x4, // red
    0x3, // blue
    0x2, // green
];

function floydSteinbergDithering(ctx, palette, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const pixels = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            const dst = (y * width + x) * 3;

            pixels[dst]     = data[src];
            pixels[dst + 1] = data[src + 1];
            pixels[dst + 2] = data[src + 2];
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {

            const pos = (y * width + x) * 3;

            const oldR = pixels[pos];
            const oldG = pixels[pos + 1];
            const oldB = pixels[pos + 2];

            let bestIndex = 0;
            let bestDistance = Infinity;

            for (let i = 0; i < palette.length; i++) {
                const p = palette[i];

                const distance =
                    Math.abs(oldR - p[0]) +
                    Math.abs(oldG - p[1]) +
                    Math.abs(oldB - p[2]);

                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            }

            const newPixel = palette[bestIndex];

            pixels[pos]     = newPixel[0];
            pixels[pos + 1] = newPixel[1];
            pixels[pos + 2] = newPixel[2];

            const errorR = oldR - newPixel[0];
            const errorG = oldG - newPixel[1];
            const errorB = oldB - newPixel[2];

            if (x + 1 < width) {
                addError(
                    pixels,
                    width,
                    x + 1,
                    y,
                    errorR,
                    errorG,
                    errorB,
                    7 / 16
                );
            }

            if (y + 1 < height) {

                if (x > 0) {
                    addError(
                        pixels,
                        width,
                        x - 1,
                        y + 1,
                        errorR,
                        errorG,
                        errorB,
                        3 / 16
                    );
                }

                addError(
                    pixels,
                    width,
                    x,
                    y + 1,
                    errorR,
                    errorG,
                    errorB,
                    5 / 16
                );

                if (x + 1 < width) {
                    addError(
                        pixels,
                        width,
                        x + 1,
                        y + 1,
                        errorR,
                        errorG,
                        errorB,
                        1 / 16
                    );
                }
            }
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 3;
            const dst = (y * width + x) * 4;

            data[dst]     = pixels[src];
            data[dst + 1] = pixels[src + 1];
            data[dst + 2] = pixels[src + 2];
            data[dst + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    return imageData;
}


function addError(
    pixels,
    width,
    x,
    y,
    errorR,
    errorG,
    errorB,
    factor
) {
    const pos = (y * width + x) * 3;

    pixels[pos]     += errorR * factor;
    pixels[pos + 1] += errorG * factor;
    pixels[pos + 2] += errorB * factor;
}

function drawScaledImage(ctx, image, stretch = false, background = "white", width = WIDTH, height = HEIGHT) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, HEIGHT);

    let scale;
    if (stretch) {
        scale = Math.max(
            width / image.width,
            height / image.height
        );
    } else {
        scale = Math.min(
            width / image.width,
            height / image.height
        );
    }

    const newWidth = Math.round(image.width * scale);
    const newHeight = Math.round(image.height * scale);

    const x = (width - newWidth) / 2;
    const y = (height - newHeight) / 2;

    ctx.filter = "brightness(112%)"; // spectra is dark unfortunately
    ctx.drawImage(
        image,
        x,
        y,
        newWidth,
        newHeight
    );
    ctx.filter = "";
}

function convertTo4bppRaw(imageData, palette = DEVICE_PALETTE, deviceIndexLookup = DEVICE_INDEX_TO_RAW, width = WIDTH, height = HEIGHT) {
    const data = imageData.data;

    const output = new Uint8Array(width * height / 2);

    let out = 0;

    // the pixels are reversed, bottom right is our top left
    for (let y = height - 1; y >= 0; y--) {
        for (let x = (width - 2); x >= 0; x -= 2) {

            const i0 = (y * width + x) * 4;
            const i1 = i0 + 4;

            const index0 = findPaletteIndex(
                data[i0],
                data[i0 + 1],
                data[i0 + 2],
                palette
            );

            const index1 = findPaletteIndex(
                data[i1],
                data[i1 + 1],
                data[i1 + 2],
                palette
            );

            const p0 = deviceIndexLookup[index0];
            const p1 = deviceIndexLookup[index1];

            output[out++] = (p0 << 4) | p1;
        }
    }

    return output;
}


function findPaletteIndex(r, g, b, palette) {
    for (let i = 0; i < palette.length; i++) {
        const p = palette[i];

        if (
            p[0] === r &&
            p[1] === g &&
            p[2] === b
        ) {
            return i;
        }
    }

    throw new Error(
        `Unexpected pixel color: ${r}, ${g}, ${b}`
    );
}