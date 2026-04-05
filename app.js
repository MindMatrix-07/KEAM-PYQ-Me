import { GoogleGenerativeAI } from "@google/generative-ai";

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-ai');
    const closeBtn = document.getElementById('close-ai');
    const chatView = document.getElementById('chat-view');
    
    const setupView = document.getElementById('setup-view');
    const messagingView = document.getElementById('messaging-view');
    
    const inputApiKey = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const setupError = document.getElementById('setup-error');
    
    const chatHistory = document.getElementById('chat-history');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const mappingData = document.getElementById('mapping-data').innerText;

    let genAI = null;
    let chatSession = null;
    let base64Pdf = null;
    let isLoadingFile = false;

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
        if (storedKey) {
            setupComplete(storedKey);
        }
    }

    saveKeyBtn.addEventListener('click', () => {
        const key = inputApiKey.value.trim();
        if (!key) {
            setupError.innerText = "Please enter an API key.";
            setupError.style.display = 'block';
            return;
        }
        localStorage.setItem('gemini_api_key', key);
        setupComplete(key);
    });

    function setupComplete(key) {
        setupError.style.display = 'none';
        setupView.style.display = 'none';
        messagingView.style.display = 'flex';
        genAI = new GoogleGenerativeAI(key);
    }

    // Convert local PDF to Base64
    async function getPdfFileAsBase64() {
        if (base64Pdf) return base64Pdf;
        isLoadingFile = true;
        try {
            const response = await fetch('KEAM_PYQ_All.pdf');
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    // Extract base64 without the data URI scheme prefix
                    const base64Data = reader.result.split(',')[1];
                    base64Pdf = base64Data;
                    isLoadingFile = false;
                    resolve(base64Data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error("Failed to load PDF:", error);
            isLoadingFile = false;
            return null;
        }
    }

    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        
        if (sender === 'ai' && typeof marked !== 'undefined') {
            contentDiv.innerHTML = marked.parse(text);
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
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
                const pdfBase64 = await getPdfFileAsBase64();
                
                if (!pdfBase64) {
                    throw new Error("Could not load the PDF file internally.");
                }

                // Initial System Instruction and file load sent as history
                chatSession = model.startChat({
                    history: [
                        {
                            role: "user",
                            parts: [
                                {
                                    inlineData: {
                                        data: pdfBase64,
                                        mimeType: "application/pdf"
                                    }
                                },
                                {
                                    text: `System Prompt Initialization: You are an expert AI assistant analyzing the attached KEAM Previous Year Questions document. It is a large scanned PDF. Here is the strict mapping of physical pages in the PDF to the respective Dates and Shifts:\n\n${mappingData}\n\nYou must explicitly use this mapping to identify the date and shift of any question you parse.`
                                }
                            ],
                        },
                        {
                            role: "model",
                            parts: [{ text: "Understood. I have scanned the entire document and saved the page mapping. How can I help you today?" }],
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
