import { GoogleGenerativeAI } from "@google/generative-ai";
import type { IOcrEngine, OcrResult } from "./types.ts";

export class GeminiEngine implements IOcrEngine {
    public name = "Gemini";
    private genAI: GoogleGenerativeAI | null = null;
    private modelName: string;

    constructor(apiKey: string, modelName: string = "gemini-2.5-flash-lite") {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelName = modelName;
    }

    async recognize(imageUrl: string): Promise<OcrResult> {
        if (!this.genAI) throw new Error("Gemini API not initialized");

        const model = this.genAI.getGenerativeModel({ model: this.modelName });

        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

        const buffer = await response.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString("base64");
        const mimeType = response.headers.get("content-type") || "image/png";

        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType
                }
            },
            "Extract all text from this image. Only return the text found in the image, nothing else."
        ]);

        return {
            text: result.response.text()
        };
    }
}
