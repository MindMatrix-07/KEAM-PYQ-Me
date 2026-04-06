import { createQuizController } from './quiz.js';

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-ai');
    const closeBtn = document.getElementById('close-ai');
    const chatView = document.getElementById('chat-view');

    const setupView = document.getElementById('setup-view');
    const messagingView = document.getElementById('messaging-view');

    const apiKeyWrapper = document.getElementById('api-key-wrapper');
    const inputApiKey = document.getElementById('api-key-input');
    const modelSelect = document.getElementById('model-select');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const setupError = document.getElementById('setup-error');
    const backendStatus = document.getElementById('backend-status');
    const questionBankStatus = document.getElementById('question-bank-status');
    const setupDescription = document.getElementById('setup-description');
    const privacyNote = document.getElementById('privacy-note');

    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const mappingData = document.getElementById('mapping-data').innerText.trim();

    const quizController = createQuizController({
        chatHistory,
        bankSummary: document.getElementById('bank-summary'),
        bankStatus: questionBankStatus,
        promptInput,
        renderMath: renderMathContent,
    });

    let backendConfigured = false;
    let backendStatusLoaded = false;
    let sessionApiKey = '';
    let selectedModelAlias = modelSelect.value;
    let conversationHistory = [];
    let cachedPdfBytes = null;
    let browserUploadedFile = null;
    let browserUploadState = null;

    toggleBtn.addEventListener('click', async () => {
        chatView.classList.add('active');
        await loadBackendStatus();
        await quizController.ensureQuestionBank().catch(() => {});
    });

    closeBtn.addEventListener('click', () => {
        chatView.classList.remove('active');
    });

    async function loadBackendStatus(force = false) {
        if (backendStatusLoaded && !force) {
            return;
        }

        saveKeyBtn.disabled = true;
        saveKeyBtn.innerText = 'Checking AI setup...';
        setupError.style.display = 'none';
        backendStatus.innerText = 'Checking whether this deployment has a server-side Gemini key...';

        try {
            const response = await fetch('/api/chat', {
                headers: { Accept: 'application/json' },
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data?.error?.message || 'Failed to load AI configuration.');
            }

            backendConfigured = Boolean(data.configured);
            backendStatusLoaded = true;
            selectedModelAlias = data.defaultModel || modelSelect.value;
            modelSelect.value = selectedModelAlias;
            renderSetupState();
            if (data.questionCount && questionBankStatus) {
                questionBankStatus.innerText = `Structured question bank: ${data.questionCount} questions available to the assistant.`;
            }
        } catch (error) {
            backendConfigured = false;
            backendStatusLoaded = false;
            backendStatus.innerText = 'The AI backend could not be reached. The site will fall back to direct Gemini requests from your browser if you enter your own API key.';
            apiKeyWrapper.style.display = 'block';
            setupDescription.innerText = 'Enter your own Gemini API key to continue, or configure `GEMINI_API_KEY` on the deployment for the server-side route.';
            privacyNote.innerText = 'In fallback mode, your browser talks directly to Gemini using your key. The app keeps the key only in memory for this tab.';
            if (questionBankStatus) {
                questionBankStatus.innerText = 'Structured question bank: still available locally in the sidebar once it loads.';
            }
        } finally {
            saveKeyBtn.disabled = false;
            saveKeyBtn.innerText = 'Start AI Assistant';
        }
    }

    function renderSetupState() {
        if (backendConfigured) {
            apiKeyWrapper.style.display = 'none';
            backendStatus.innerText = 'Server-side Gemini key detected. The bundled KEAM PDF will be used automatically.';
            setupDescription.innerText = 'Choose a model and start the assistant. You do not need to upload the PDF or paste an API key on this deployment.';
            privacyNote.innerText = 'For visitors, Gemini requests are routed through the site backend. If you prefer, you can still modify the code to require user-supplied keys.';
        } else {
            apiKeyWrapper.style.display = 'block';
            backendStatus.innerText = 'No server-side Gemini key detected.';
            setupDescription.innerText = 'Enter your own Gemini API key to continue. The backend will still use the bundled KEAM PDF automatically.';
            privacyNote.innerText = 'Your key is kept only in this browser session by the app, then forwarded to the backend for Gemini requests.';
        }
    }

    saveKeyBtn.addEventListener('click', async () => {
        if (!backendStatusLoaded) {
            await loadBackendStatus();
        }

        sessionApiKey = inputApiKey.value.trim();
        selectedModelAlias = modelSelect.value;

        if (!backendConfigured && !sessionApiKey) {
            setupError.innerText = 'Enter a Gemini API key or configure `GEMINI_API_KEY` on the deployment.';
            setupError.style.display = 'block';
            return;
        }

        setupError.style.display = 'none';
        setupView.style.display = 'none';
        messagingView.style.display = 'flex';
        await quizController.ensureQuestionBank().catch(() => {});
        promptInput.focus();
    });

    function renderMathContent(node) {
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(node, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                ],
                throwOnError: false,
            });
        }
    }

    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';

        if (sender === 'ai' && typeof marked !== 'undefined') {
            contentDiv.innerHTML = marked.parse(text);
            renderMathContent(contentDiv);
        } else {
            contentDiv.innerText = text;
        }

        msgDiv.appendChild(contentDiv);
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function addLoader() {
        const id = 'loader-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai-message';
        msgDiv.id = id;
        msgDiv.innerHTML = `
            <div class="content loading-dots">
                <div class="dot"></div><div class="dot"></div><div class="dot"></div>
            </div>
        `;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return id;
    }

    async function getBundledPdfBytes() {
        if (cachedPdfBytes) {
            return cachedPdfBytes;
        }

        const response = await fetch('KEAM_PYQ_All.pdf');
        if (!response.ok) {
            throw new Error('Failed to load the bundled KEAM PDF.');
        }

        cachedPdfBytes = await response.arrayBuffer();
        return cachedPdfBytes;
    }

    async function fetchGeminiJson(url, options) {
        const response = await fetch(url, options);
        const text = await response.text();
        let data = null;

        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }

        return { response, data };
    }

    function createClientGeminiError(status, payload) {
        const message = payload?.error?.message || 'Gemini request failed.';
        const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
        const retryInfo = details.find((detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
        const error = new Error(message);
        error.code = status === 429 || /quota/i.test(message) ? 'QUOTA_EXCEEDED' : status === 400 || status === 401 || status === 403 ? 'INVALID_API_KEY' : 'AI_REQUEST_FAILED';
        error.retryAfter = retryInfo?.retryDelay || null;
        error.providerMessage = message;
        return error;
    }

    async function uploadBundledPdfToGemini(apiKey) {
        const pdfBytes = await getBundledPdfBytes();

        const startUpload = await fetchGeminiJson('https://generativelanguage.googleapis.com/upload/v1beta/files', {
            method: 'POST',
            headers: {
                'x-goog-api-key': apiKey,
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': String(pdfBytes.byteLength),
                'X-Goog-Upload-Header-Content-Type': 'application/pdf',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                file: {
                    display_name: 'KEAM_PYQ_All.pdf',
                },
            }),
        });

        if (!startUpload.response.ok) {
            throw createClientGeminiError(startUpload.response.status, startUpload.data);
        }

        const uploadUrl = startUpload.response.headers.get('x-goog-upload-url');
        if (!uploadUrl) {
            throw new Error('Gemini upload URL was missing.');
        }

        const finishUpload = await fetchGeminiJson(uploadUrl, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize',
                'Content-Type': 'application/pdf',
            },
            body: pdfBytes,
        });

        if (!finishUpload.response.ok) {
            throw createClientGeminiError(finishUpload.response.status, finishUpload.data);
        }

        let file = finishUpload.data?.file;
        while (file?.state === 'PROCESSING') {
            await new Promise((resolve) => setTimeout(resolve, 1500));

            const fileStatus = await fetchGeminiJson(`https://generativelanguage.googleapis.com/v1beta/files/${file.name}`, {
                headers: {
                    'x-goog-api-key': apiKey,
                },
            });

            if (!fileStatus.response.ok) {
                throw createClientGeminiError(fileStatus.response.status, fileStatus.data);
            }

            file = fileStatus.data?.file;
        }

        if (!file?.uri) {
            throw new Error('Gemini did not return a reusable PDF file URI.');
        }

        return {
            apiKey,
            uri: file.uri,
            mimeType: file.mimeType || 'application/pdf',
            expiresAt: file.expirationTime ? Date.parse(file.expirationTime) : Date.now() + 47 * 60 * 60 * 1000,
        };
    }

    async function ensureBrowserUploadedPdf(apiKey) {
        const cacheIsValid =
            browserUploadedFile &&
            browserUploadedFile.apiKey === apiKey &&
            browserUploadedFile.expiresAt > Date.now() + 5 * 60 * 1000;

        if (cacheIsValid) {
            return browserUploadedFile;
        }

        if (!browserUploadState || browserUploadState.apiKey !== apiKey) {
            browserUploadState = {
                apiKey,
                promise: uploadBundledPdfToGemini(apiKey)
                    .then((fileInfo) => {
                        browserUploadedFile = fileInfo;
                        return fileInfo;
                    })
                    .finally(() => {
                        if (browserUploadState?.apiKey === apiKey) {
                            browserUploadState = null;
                        }
                    }),
            };
        }

        return browserUploadState.promise;
    }

    function buildSystemPrompt() {
        return `You are an expert AI assistant analyzing the attached KEAM Previous Year Questions document. It is a large scanned PDF. Here is the strict mapping of physical pages in the PDF to the respective dates and shifts:\n\n${mappingData}\n\nCritical instructions:\n1. Use this mapping to identify the correct paper before answering.\n2. Quiz mode is the default behavior. If the user asks for questions, present the question and options first, then wait for the user's attempt before giving the answer.\n3. Use LaTeX for all mathematics. Wrap inline formulas with $...$ and block formulas with $$...$$.\n4. If any scan is unclear, say so explicitly instead of guessing.`;
    }

    function extractGeminiReply(payload) {
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        return parts
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('\n\n')
            .trim();
    }

    function removeLoader(id) {
        const loader = document.getElementById(id);
        if (loader) {
            loader.remove();
        }
    }

    async function requestAssistantInBrowser(prompt) {
        const uploadedFile = await ensureBrowserUploadedPdf(sessionApiKey);
        const payload = {
            system_instruction: {
                parts: [{ text: buildSystemPrompt() }],
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
                            text: 'Understood. I will use the KEAM PDF and its page mapping for this conversation.',
                        },
                    ],
                },
                ...conversationHistory.slice(-12).map((item) => ({
                    role: item.role,
                    parts: [{ text: item.text }],
                })),
                {
                    role: 'user',
                    parts: [{ text: prompt }],
                },
            ],
        };

        const { response, data } = await fetchGeminiJson(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModelAlias}:generateContent`, {
            method: 'POST',
            headers: {
                'x-goog-api-key': sessionApiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw createClientGeminiError(response.status, data);
        }

        const reply = extractGeminiReply(data);
        if (!reply) {
            throw new Error('Gemini returned an empty response.');
        }

        return reply;
    }

    async function requestAssistant(prompt) {
        if (!backendStatusLoaded) {
            return requestAssistantInBrowser(prompt);
        }

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                apiKey: sessionApiKey,
                model: selectedModelAlias,
                message: prompt,
                history: conversationHistory,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const error = new Error(data?.error?.message || 'The AI request failed.');
            error.code = data?.error?.code || 'AI_REQUEST_FAILED';
            error.retryAfter = data?.error?.retryAfter || null;
            error.providerMessage = data?.error?.providerMessage || '';
            throw error;
        }

        return data.reply;
    }

    function formatAiError(error) {
        if (error.code === 'MISSING_API_KEY') {
            return '❌ Gemini is not configured for this deployment yet. Add `GEMINI_API_KEY` in Vercel or reopen the panel and enter your own key.';
        }

        if (error.code === 'QUOTA_EXCEEDED') {
            const retryHint = error.retryAfter ? ` Google suggested retrying after ${error.retryAfter}.` : '';
            return `❌ Gemini quota is exhausted for the current API key or project.${retryHint}\n\nAdd a billed \`GEMINI_API_KEY\` in Vercel, or use a different Gemini key with available quota.`;
        }

        if (error.code === 'INVALID_API_KEY') {
            return '❌ The Gemini API key was rejected. Reopen the panel and use a valid key, or configure `GEMINI_API_KEY` on the deployment.';
        }

        if (error.code === 'BACKEND_MISCONFIGURED') {
            return '❌ The AI backend could not read the bundled KEAM PDF. Make sure the PDF is included in the deployment and redeploy the site.';
        }

        return `❌ ${error.message || 'An unexpected error occurred while contacting Gemini.'}`;
    }

    sendBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) {
            return;
        }

        if (quizController.maybeHandlePrompt(prompt)) {
            addMessage(prompt, 'user');
            promptInput.value = '';
            promptInput.focus();
            return;
        }

        addMessage(prompt, 'user');
        promptInput.value = '';
        promptInput.disabled = true;
        sendBtn.disabled = true;

        const loaderId = addLoader();

        try {
            const reply = await requestAssistant(quizController.augmentPrompt(prompt));
            removeLoader(loaderId);
            addMessage(reply, 'ai');
            conversationHistory.push({ role: 'user', text: prompt });
            conversationHistory.push({ role: 'model', text: reply });
        } catch (error) {
            removeLoader(loaderId);
            console.error(error);
            addMessage(formatAiError(error), 'ai');
        } finally {
            promptInput.disabled = false;
            sendBtn.disabled = false;
            promptInput.focus();
        }
    });

    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });
});
