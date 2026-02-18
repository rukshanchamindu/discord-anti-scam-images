export interface OcrResult {
    text: string;
    confidence?: number;
}

export interface IOcrEngine {
    name: string;
    initialize?(): Promise<void>;
    recognize(imageUrl: string): Promise<OcrResult>;
    destroy?(): Promise<void>;
}
