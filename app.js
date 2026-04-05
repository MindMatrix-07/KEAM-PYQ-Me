import { GoogleGenerativeAI } from "@google/generative-ai";

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-ai');
    const closeBtn = document.getElementById('close-ai');
    const chatView = document.getElementById('chat-view');
    
    const setupView = document.getElementById('setup-view');
    const messagingView = document.getElementById('messaging-view');
    
    const inputApiKey = document.getElementById('api-key-input');
    const modelSelect = document.getElementById('model-select');
    const pdfFileInput = document.getElementById('pdf-file-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const setupError = document.getElementById('setup-error');
    
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const mappingData = document.getElementById('mapping-data').innerText;

    let genAI = null;
    let chatSession = null;
    let base64Pdf = null;
    let selectedModelAlias = "gemini-1.5-flash";

    // Toggle Chat Panel
    toggleBtn.addEventListener('click', () => {
        chatView.classList.add('active');
        checkExistingKey();
    });

    closeBtn.addEventListener('click', () => {
        chatView.classList.remove('active');
    });

    function checkExistingKey() {
        const storedKey = localStorage.getItem('gemini_api_key');
        const storedModel = localStorage.getItem('gemini_model_alias');
        if (storedKey) {
            inputApiKey.value = storedKey;
            if (storedModel) {
                modelSelect.value = storedModel;
                selectedModelAlias = storedModel;
            }
            // setupComplete(storedKey); // Don't auto-start now, let user press start to confirm model
        }
    }

    saveKeyBtn.addEventListener('click', async () => {
        const key = inputApiKey.value.trim();
        if (!key) {
            setupError.innerText = "Please enter an API key.";
            setupError.style.display = 'block';
            return;
        }
        
        if (!pdfFileInput.files || pdfFileInput.files.length === 0) {
            setupError.innerText = "Please select the KEAM_PYQ_All.pdf file from your computer.";
            setupError.style.display = 'block';
            return;
        }

        saveKeyBtn.disabled = true;
        saveKeyBtn.innerText = 'Reading PDF...';
        setupError.style.display = 'none';

        try {
            base64Pdf = await readLocalFile(pdfFileInput.files[0]);
        } catch (e) {
            setupError.innerText = "Failed to read the PDF file. Please try again.";
            setupError.style.display = 'block';
            saveKeyBtn.disabled = false;
            saveKeyBtn.innerText = 'Start AI Analysis';
            return;
        }
        
        selectedModelAlias = modelSelect.value;
        localStorage.setItem('gemini_api_key', key);
        localStorage.setItem('gemini_model_alias', selectedModelAlias);
        setupComplete(key);
        saveKeyBtn.disabled = false;
        saveKeyBtn.innerText = 'Start AI Analysis';
    });

    function setupComplete(key) {
        setupError.style.display = 'none';
        setupView.style.display = 'none';
        messagingView.style.display = 'flex';
        genAI = new GoogleGenerativeAI(key);
    }

    // Read local PDF file selected by the user
    function readLocalFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        
        if (sender === 'ai' && typeof marked !== 'undefined') {
            contentDiv.innerHTML = marked.parse(text);
            // Render Math Equations with KaTeX
            if (typeof renderMathInElement !== 'undefined') {
                renderMathInElement(contentDiv, {
                  delimiters: [
                      {left: '$$', right: '$$', display: true},
                      {left: '\\[', right: '\\]', display: true},
                      {left: '$', right: '$', display: false},
                      {left: '\\(', right: '\\)', display: false}
                  ],
                  throwOnError: false
                });
            }
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

    function removeLoader(id) {
        const loader = document.getElementById(id);
        if (loader) loader.remove();
    }

    sendBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) return;

        addMessage(prompt, 'user');
        promptInput.value = '';
        promptInput.disabled = true;
        sendBtn.disabled = true;

        const loaderId = addLoader();

        try {
            // First time init stream
            if (!chatSession) {
                const model = genAI.getGenerativeModel({ model: selectedModelAlias });
                
                if (!base64Pdf) {
                    throw new Error("PDF not loaded. Please close this panel, click 'Use AI Assistant' again, and select the PDF file.");
                }

                // Initial System Instruction and file load sent as history
                chatSession = model.startChat({
                    history: [
                        {
                            role: "user",
                            parts: [
                                {
                                    inlineData: {
                                        data: base64Pdf,
                                        mimeType: "application/pdf"
                                    }
                                },
                                {
                                    text: `System Prompt Initialization: You are an expert AI assistant analyzing the attached KEAM Previous Year Questions document. It is a large scanned PDF. Here is the strict mapping of physical pages in the PDF to the respective Dates and Shifts:\n\n${mappingData}\n\nCRITICAL INSTRUCTIONS:\n1. Use this mapping to identify the date and shift of any question you parse.\n2. QUIZ MODE: If the user asks for questions, DO NOT solve them immediately! Present the question as a Quiz. Give the options, then WAIT. Only after the user attempts the question should you give the correct answer and the full step-by-step mathematical explanation.\n3. MATH TYPOGRAPHY: You MUST use exact LaTeX formatting for all mathematical equations, variables, and symbols so they render perfectly natively. Wrap inline formulas with a single dollar sign (like $x^2$) and display block formulas with double dollar signs (like $$y=mx+c$$) or \\[...\\]`
                                }
                            ],
                        },
                        {
                            role: "model",
                            parts: [{ text: "Understood! I am locked into Quiz Mode. I will present questions to the user and withhold the answer until they guess. I will also strictly use LaTeX ($...$) for all mathematical symbols and equations." }],
                        }
                    ],
                });
            }

            // Send actual user message
            const result = await chatSession.sendMessage(prompt);
            const response = await result.response;
            removeLoader(loaderId);
            addMessage(response.text(), 'ai');

        } catch (error) {
            removeLoader(loaderId);
            console.error(error);
            if (error.message && error.message.includes("API key")) {
                addMessage("❌ Error: Invalid API Key. Please click the Close button, refresh the page to reset, and put a valid key.", 'ai');
                localStorage.removeItem('gemini_api_key');
            } else {
                addMessage("❌ An error occurred connecting to Google Gemini: " + error.message, 'ai');
            }
        }

        promptInput.disabled = false;
        sendBtn.disabled = false;
        promptInput.focus();
    });

    // Support Enter to send
    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

});
