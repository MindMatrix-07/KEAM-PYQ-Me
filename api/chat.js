const fs = require('fs/promises');
const path = require('path');
const mappingEntries = require('../index_mapping.json');

const PDF_FILENAME = 'KEAM_PYQ_All.pdf';
const DEFAULT_MODEL = 'gemini-2.5-pro';
const MAX_HISTORY_MESSAGES = 12;
const ALLOWED_MODELS = new Set([
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
]);

const SYSTEM_PROMPT = `You are an expert AI assistant for KEAM previous year questions.

You are working with a single bundled PDF that contains multiple scanned KEAM papers. The page mapping below is authoritative, and you must use it whenever the user asks for a year, date, shift, or paper.

${mappingEntries
    .map((entry) => `- Pages ${entry.start_page} to ${entry.end_page}: ${entry.exam_info}`)
    .join('\n')}

Critical instructions:
1. Use the page mapping above to identify the correct paper before answering.
2. Quiz mode is the default behavior. If the user asks for questions, show the question and options first, then wait for the user's attempt before revealing the answer and explanation.
3. Use LaTeX for mathematics. Wrap inline math with $...$ and block math with $$...$$.
4. If the scan is unclear, say so explicitly instead of inventing text.
5. Prefer concise, step-by-step explanations for physics, chemistry, and mathematics problems.`;

let cachedPdfBuffer = null;
let cachedUploadedFile = null;
let uploadState = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
}

async function parseBody(req) {
    if (!req.body) {
        const chunks = [];

        for await (const chunk of req) {
            chunks.push(chunk);
        }

        if (!chunks.length) {
            return {};
        }

        try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            return {};
        }
    }

    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            return {};
        }
    }

    return req.body;
}

function sanitizeHistory(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .slice(-MAX_HISTORY_MESSAGES)
        .flatMap((item) => {
            const text = typeof item?.text === 'string' ? item.text.trim() : '';
            const role = item?.role === 'model' || item?.role === 'assistant' ? 'model' : item?.role === 'user' ? 'user' : null;

            if (!text || !role) {
                return [];
            }

            return [
                {
                    role,
                    parts: [{ text }],
                },
            ];
        });
}

async function getPdfBuffer() {
    if (cachedPdfBuffer) {
        return cachedPdfBuffer;
    }

    const pdfPath = path.join(process.cwd(), PDF_FILENAME);

    try {
        cachedPdfBuffer = await fs.readFile(pdfPath);
    } catch (error) {
        const appError = new Error(`Unable to read ${PDF_FILENAME} from the deployment bundle.`);
        appError.code = 'BACKEND_MISCONFIGURED';
        throw appError;
    }

    return cachedPdfBuffer;
}

async function fetchGemini(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;

    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }

    return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        text,
        data,
    };
}

async function uploadPdfToGemini(apiKey) {
    const pdfBuffer = await getPdfBuffer();

    const startUpload = await fetchGemini('https://generativelanguage.googleapis.com/upload/v1beta/files', {
        method: 'POST',
        headers: {
            'x-goog-api-key': apiKey,
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(pdfBuffer.length),
            'X-Goog-Upload-Header-Content-Type': 'application/pdf',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            file: {
                display_name: 'KEAM_PYQ_All.pdf',
            },
        }),
    });

    if (!startUpload.ok) {
        throw createGeminiError(startUpload.status, startUpload.data);
    }

    const uploadUrl = startUpload.headers.get('x-goog-upload-url');

    if (!uploadUrl) {
        const error = new Error('Gemini upload did not return an upload URL.');
        error.code = 'GEMINI_UPLOAD_FAILED';
        throw error;
    }

    const finishUpload = await fetchGemini(uploadUrl, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
            'Content-Type': 'application/pdf',
        },
        body: pdfBuffer,
    });

    if (!finishUpload.ok) {
        throw createGeminiError(finishUpload.status, finishUpload.data);
    }

    let file = finishUpload.data?.file;

    if (!file?.name) {
        const error = new Error('Gemini did not return uploaded file metadata.');
        error.code = 'GEMINI_UPLOAD_FAILED';
        throw error;
    }

    while (file?.state === 'PROCESSING') {
        await sleep(1500);

        const fileStatus = await fetchGemini(`https://generativelanguage.googleapis.com/v1beta/files/${file.name}`, {
            headers: {
                'x-goog-api-key': apiKey,
            },
        });

        if (!fileStatus.ok) {
            throw createGeminiError(fileStatus.status, fileStatus.data);
        }

        file = fileStatus.data?.file;
    }

    if (file?.state === 'FAILED') {
        const error = new Error('Gemini failed to process the KEAM PDF.');
        error.code = 'GEMINI_UPLOAD_FAILED';
        throw error;
    }

    return {
        apiKey,
        uri: file?.uri,
        mimeType: file?.mimeType || 'application/pdf',
        expiresAt: file?.expirationTime ? Date.parse(file.expirationTime) : Date.now() + 47 * 60 * 60 * 1000,
    };
}

async function ensureUploadedPdf(apiKey) {
    const hasLiveCache =
        cachedUploadedFile &&
        cachedUploadedFile.apiKey === apiKey &&
        cachedUploadedFile.uri &&
        cachedUploadedFile.expiresAt > Date.now() + 5 * 60 * 1000;

    if (hasLiveCache) {
        return cachedUploadedFile;
    }

    if (!uploadState || uploadState.apiKey !== apiKey) {
        uploadState = {
            apiKey,
            promise: uploadPdfToGemini(apiKey)
                .then((fileInfo) => {
                    cachedUploadedFile = fileInfo;
                    return fileInfo;
                })
                .finally(() => {
                    if (uploadState?.apiKey === apiKey) {
                        uploadState = null;
                    }
                }),
        };
    }

    return uploadState.promise;
}

function createGeminiError(status, payload) {
    const providerMessage = payload?.error?.message || 'Gemini API request failed.';
    const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
    const retryInfo = details.find((detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
    const quotaFailure = details.find((detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure');

    const error = new Error(providerMessage);
    error.status = status;
    error.providerMessage = providerMessage;
    error.retryAfter = retryInfo?.retryDelay || null;
    error.quotaDetails = quotaFailure?.violations || [];

    if (status === 429 || /quota/i.test(providerMessage)) {
        error.code = 'QUOTA_EXCEEDED';
    } else if (status === 400 && /api key/i.test(providerMessage)) {
        error.code = 'INVALID_API_KEY';
    } else if (status === 401 || status === 403) {
        error.code = 'INVALID_API_KEY';
    } else {
        error.code = 'GEMINI_ERROR';
    }

    return error;
}

function extractReply(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const text = parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n\n')
        .trim();

    return text || null;
}

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        return json(res, 200, {
            configured: Boolean(process.env.GEMINI_API_KEY),
            defaultModel: DEFAULT_MODEL,
            allowedModels: Array.from(ALLOWED_MODELS),
        });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return json(res, 405, {
            error: {
                code: 'METHOD_NOT_ALLOWED',
                message: 'Use GET to inspect setup and POST to chat.',
            },
        });
    }

    try {
        const body = await parseBody(req);
        const apiKey = (body.apiKey || process.env.GEMINI_API_KEY || '').trim();
        const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const history = sanitizeHistory(body.history);

        if (!apiKey) {
            return json(res, 400, {
                error: {
                    code: 'MISSING_API_KEY',
                    message: 'No Gemini API key is configured for this deployment.',
                },
            });
        }

        if (!message) {
            return json(res, 400, {
                error: {
                    code: 'EMPTY_MESSAGE',
                    message: 'Message text is required.',
                },
            });
        }

        const uploadedFile = await ensureUploadedPdf(apiKey);
        const payload = {
            system_instruction: {
                parts: [{ text: SYSTEM_PROMPT }],
            },
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            file_data: {
                                mime_type: uploadedFile.mimeType,
                                file_uri: uploadedFile.uri,
                            },
                        },
                        {
                            text: 'This is the bundled KEAM master PDF for the conversation. Use it as the source document for all answers.',
                        },
                    ],
                },
                {
                    role: 'model',
                    parts: [
                        {
                            text: 'Understood. I will use the KEAM PDF and the page mapping for all answers in this chat.',
                        },
                    ],
                },
                ...history,
                {
                    role: 'user',
                    parts: [{ text: message }],
                },
            ],
        };

        const response = await fetchGemini(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'x-goog-api-key': apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }
        );

        if (!response.ok) {
            throw createGeminiError(response.status, response.data);
        }

        const reply = extractReply(response.data);

        if (!reply) {
            return json(res, 502, {
                error: {
                    code: 'EMPTY_AI_RESPONSE',
                    message: 'Gemini returned an empty response for this prompt.',
                },
            });
        }

        return json(res, 200, { reply });
    } catch (error) {
        if (error.code === 'BACKEND_MISCONFIGURED') {
            return json(res, 500, {
                error: {
                    code: error.code,
                    message: error.message,
                },
            });
        }

        if (error.code === 'QUOTA_EXCEEDED' || error.code === 'INVALID_API_KEY' || error.code === 'GEMINI_ERROR') {
            return json(res, error.status || 502, {
                error: {
                    code: error.code,
                    message:
                        error.code === 'QUOTA_EXCEEDED'
                            ? 'Gemini quota is exhausted for the current API key or project.'
                            : error.providerMessage || error.message,
                    providerMessage: error.providerMessage || error.message,
                    retryAfter: error.retryAfter,
                },
            });
        }

        return json(res, 500, {
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Unexpected server error.',
            },
        });
    }
};
