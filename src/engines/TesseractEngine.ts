import { createWorker } from "tesseract.js";
import type { IOcrEngine, OcrResult } from "./types.ts";

export class TesseractEngine implements IOcrEngine {
    public name = "Tesseract";
    private worker: any = null;

    async initialize() {
        this.worker = await createWorker("eng");
    }

    async recognize(imageUrl: string): Promise<OcrResult> {
        if (!this.worker) throw new Error("Tesseract worker not initialized");
        const result = await this.worker.recognize(imageUrl);
        return {
            text: result.data.text,
            confidence: result.data.confidence
        };
    }

    async destroy() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}
