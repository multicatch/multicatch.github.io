let loadedImage = null;

function isBrightnessFilterSupported(ctx, width, height) {
    ctx.fillStyle = "rgb(100, 100, 100)";
    ctx.fillRect(0, 0, width, height);

    ctx.filter = "brightness(200%)";
    ctx.fillRect(0, 0, width, height);

    const pixel = ctx.getImageData(0, 0, 1, 1).data;

    return pixel[0] > 150;
}

function adjustBrightness(ctx, brightness, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const factor = brightness / 100.0;

    for (let i = 0; i < data.byteLength; i += 4) {
        data[i] *= factor;
        data[i + 1] *= factor;
        data[i + 2] *= factor;
    }

    ctx.putImageData(imageData, 0, 0);
}

function drawScaledImage(ctx, image, stretch = false, brightness = 110, background = "white", width = WIDTH, height = HEIGHT) {
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

    const filterSupported = isBrightnessFilterSupported(ctx, width, height);

    if (filterSupported) {
        ctx.filter = `brightness(${brightness}%)`;
    }
    ctx.drawImage(
        image,
        x,
        y,
        newWidth,
        newHeight
    );
    ctx.filter = "";
    if (!filterSupported) {
        adjustBrightness(ctx, brightness, width, height);
    }
}

function initFileLoader(filePicker, stretchToFill, brightnessRange, ctx) {
    filePicker.addEventListener("change", event => {
        const file = event.target.files[0];

        if (!file) {
            return;
        }

        if (loadedImage != null) {
            URL.revokeObjectURL(loadedImage.src);
        }
        loadedImage = new Image();
        loadedImage.onload = () => {
            drawScaledImage(ctx, loadedImage, stretchToFill.checked, brightnessRange.value);
        };
        loadedImage.src = URL.createObjectURL(file);
    });
}

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const IMAGE_UPLOAD_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const NUMBER_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a9";

class BLEDevice {
    constructor(device) {
        this.device = device;
        this.server = null;
        console.log("Connected to:", device.name);
    }

    connectIfNeeded = async () => {
        if (this.server && this.server != null) {
            return;
        }
        this.server = await this.device.gatt.connect();
        console.log("Connected to:", this.device.name);
    }

    primaryService = async () => {
        await this.connectIfNeeded();
        return await this.server.getPrimaryService(SERVICE_UUID);
    }

    lineNumberService = async () => {
        const service = await this.primaryService();
        return await service.getCharacteristic(NUMBER_UUID);
    }

    imageUploadService = async () => {
        const service = await this.primaryService();
        return await service.getCharacteristic(IMAGE_UPLOAD_UUID);
    }
}

let currentConnection = null;

function initBLEUploader(connectButton, sendButton, statusElement, ctx) {
    connectButton.addEventListener("click", () => connectBLE(sendButton, statusElement));
    sendButton.addEventListener("click", () => sendImage(sendButton, statusElement, ctx));
}

async function connectBLE(sendButton, statusElement) {
    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [SERVICE_UUID] }
            ]
        });
        currentConnection = new BLEDevice(device);
        currentConnection.connectIfNeeded();
        sendButton.disabled = false;
        if (statusElement) {
            statusElement.innerText = "Connected to " + device.name;
        }
    } catch (error) {
        console.error("Bluetooth connection failed:", error);
    }
}

async function disconnectBLE(sendButton) {
    try {
        currentConnection.device.gatt.disconnect();
        currentConnection = null;
        sendButton.disabled = true;
    } catch (error) {
        console.error("Bluetooth disconnection failed:", error);
    }
}

async function sendInChunks(data, statusElement, width = 800, height = 480) {
    if (currentConnection == null) {
        throw new Error("Not connected to the ESP32");
    }

    const chunkSize = width / 2;

    console.log("Sending ", data.byteLength, " bytes");
    let i = 0;

    const uploadService = await currentConnection.imageUploadService();

    for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
        console.log("Sending chunk ", i);
        const chunk = new Uint8Array(data.slice(
            offset,
            Math.min(offset + chunkSize, data.byteLength)
        ));
        const chunkWithIndex = new Uint8Array(chunk.length + 2);
        chunkWithIndex.set(new Uint8Array([(i >> 8) & 0xFF, (i & 0xFF)]));
        chunkWithIndex.set(chunk, 2);

        if (statusElement) {
            statusElement.innerText = "Sending... " + (((i + 1) / (height * 1.00)) * 100.0).toFixed(2) + "%";
        }

        console.log("Sent chunk:", i, " of length ", chunk.length, "bytes");
        if (i == height - 1 && statusElement) {
            statusElement.innerText = "Waiting for screen refresh."
        }
        await uploadService.writeValueWithResponse(chunkWithIndex);
        i += 1;
        if (i >= height) {
            break;
        }
    }

    const numberCharacteristic = await currentConnection.lineNumberService();
    const value = await numberCharacteristic.readValue();
    const number = value.getUint16(0, true); // true = little-endian

    console.log("Number from ESP32:", number);

    if (statusElement) {
        if (number != 0) {
            statusElement.innerText = "Write error.";
        } else {
            statusElement.innerText = "Success.";
        }
    }
}

async function sendImage(sendButton, statusElement, ctx, width = WIDTH, height = HEIGHT) {
    const imageData = floydSteinbergDithering(
        ctx,
        DEVICE_PALETTE,
        width, height
    );
    ctx.putImageData(imageData, 0, 0);
    const raw = convertTo4bppRaw(imageData);

    console.log("RAW:", raw, "size:", raw.length);

    try {
        await sendInChunks(raw, statusElement, width, height);
    } finally {
        await disconnectBLE(sendButton);
    }
}

