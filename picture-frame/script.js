function initFileLoader(filePicker, stretchToFill, ctx) {
    filePicker.addEventListener("change", event => {
        const file = event.target.files[0];

        if (!file) {
            return;
        }

        const image = new Image();
        image.onload = () => {
            drawScaledImage(ctx, image, stretchToFill.checked);
            URL.revokeObjectURL(image.src);
        };
        image.src = URL.createObjectURL(file);
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
    connectButton.addEventListener("click", () => connectBLE(sendButton));
    sendButton.addEventListener("click", () => sendImage(sendButton, statusElement, ctx));
}

async function connectBLE(sendButton) {
    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [SERVICE_UUID] }
            ]
        });
        currentConnection = new BLEDevice(device);
        currentConnection.connectIfNeeded();
        sendButton.disabled = false;
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

