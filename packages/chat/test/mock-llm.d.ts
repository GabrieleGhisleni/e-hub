export type MockToolCall = {
    name: string;
    arguments: Record<string, unknown>;
};
export type MockTurn = {
    text: string;
} | {
    toolCalls: MockToolCall[];
};
export type MockLlm = {
    /** Base URL including `/v1`, ready for EHUB_AI_BASE_URL. */
    baseURL: string;
    /** Parsed JSON bodies of the requests received, in order. */
    requests: any[];
    /** Request headers (lower-case names) of each request, in order. */
    requestHeaders: Record<string, string>[];
    close(): Promise<void>;
};
export type MockLlmOptions = {
    /** Extra headers sent on every response (e.g. the router's `x-router-model`). */
    responseHeaders?: Record<string, string>;
};
export declare function startMockLlm(turns: MockTurn[], options?: MockLlmOptions): Promise<MockLlm>;
