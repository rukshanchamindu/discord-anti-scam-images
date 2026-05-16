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

    async recognize(imageUrl: string | string[]): Promise<OcrResult> {
        if (!this.genAI) throw new Error("Gemini API not initialized");

        const model = this.genAI.getGenerativeModel({ model: this.modelName });
        const urls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
        const contentParts: any[] = [];

        // Fetch all images and convert to base64 parts
        for (const url of urls) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

            const buffer = await response.arrayBuffer();
            const base64Data = Buffer.from(buffer).toString("base64");
            const mimeType = response.headers.get("content-type") || "image/png";

            contentParts.push({
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType
                }
            });
        }

        // Add the prompt at the end
        contentParts.push("Extract all text from these images. Only return the text found in the images, nothing else.");

        const result = await model.generateContent(contentParts);

        return {
            text: result.response.text()
        };
    }
}
