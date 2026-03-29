import sharp from "sharp";
import { Buffer } from "node:buffer";
import type { IOcrEngine, OcrResult } from "./types.ts";

export class OcrSpaceEngine implements IOcrEngine {
    public name = "OcrSpace";
    private apiKey: string;
    private apiUrl = "https://api.ocr.space/parse/image";

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async recognize(imageUrl: string): Promise<OcrResult> {
        if (!this.apiKey) throw new Error("OCR Space API Key not provided");

        // Fetch image
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

        let buffer: any = Buffer.from(await response.arrayBuffer());

        // Check size and compress if needed (OCR.Space FREE limit is 1MB)
        if (buffer.length > 1024 * 1024) {
            console.log(`[OcrSpace] Image is ${ (buffer.length / 1024 / 1024).toFixed(2) }MB. Reducing to < 1MB...`);
            buffer = await this.compressImage(buffer);
            console.log(`[OcrSpace] Compressed to ${ (buffer.length / 1024 / 1024).toFixed(2) }MB`);
        }

        const base64Image = `data:image/png;base64,${buffer.toString("base64")}`;

        const formData = new URLSearchParams();
        formData.append("apikey", this.apiKey);
        formData.append("base64Image", base64Image);
        formData.append("language", "eng");
        formData.append("isOverlayRequired", "false");
        formData.append("scale", "true"); // Helps with accuracy for small text
        formData.append("OCREngine", "2"); // Engine 2 is often better for complex layouts

        const ocrResponse = await fetch(this.apiUrl, {
            method: "POST",
            body: formData,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        if (!ocrResponse.ok) {
            throw new Error(`OCR Space API failed: ${ocrResponse.statusText}`);
        }

        const data: any = await ocrResponse.json();

        if (data.IsErroredOnProcessing) {
            throw new Error(`OCR Space Error: ${data.ErrorMessage.join(", ")}`);
        }

        const text = data.ParsedResults?.[0]?.ParsedText || "";

        return {
            text: text
        };
    }

    private async compressImage(buffer: Buffer): Promise<any> {
        // Initial attempt: resize by 75% or just adjust quality
        let quality = 80;
        let resizedBuffer = await sharp(buffer)
            .resize({ width: 2000, withoutEnlargement: true }) // Prevent too large images
            .jpeg({ quality })
            .toBuffer();

        // If still over 1MB, reduce quality further
        while (resizedBuffer.length > 1024 * 1024 && quality > 10) {
            quality -= 10;
            resizedBuffer = await sharp(buffer)
                .resize({ width: 1500, withoutEnlargement: true })
                .jpeg({ quality })
                .toBuffer();
        }

        return resizedBuffer;
    }
}
