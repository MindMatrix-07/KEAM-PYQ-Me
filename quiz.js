const PROFILE_STORAGE_KEY = 'keam-ai-person-profiles';
const PROGRESS_STORAGE_KEY = 'keam-ai-person-progress';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function createOptionNode(value, label = 'All') {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function sortText(values) {
    return Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function readJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

export function createQuizController(options) {
    const {
        chatHistory,
        bankSummary,
        bankStatus,
        promptInput,
        renderMath,
    } = options;

    const quizPanel = document.getElementById('quiz-panel');
    const chatModeBtn = document.getElementById('chat-mode-btn');
    const quizModeBtn = document.getElementById('quiz-mode-btn');
    const personSelect = document.getElementById('person-select');
    const addPersonBtn = document.getElementById('add-person-btn');
    const yearFilter = document.getElementById('year-filter');
    const dateFilter = document.getElementById('date-filter');
    const shiftFilter = document.getElementById('shift-filter');
    const subjectFilter = document.getElementById('subject-filter');
    const chapterFilter = document.getElementById('chapter-filter');
    const topicFilter = document.getElementById('topic-filter');
    const startQuizBtn = document.getElementById('start-quiz-btn');
    const nextQuizBtn = document.getElementById('next-quiz-btn');
    const resetQuizBtn = document.getElementById('reset-quiz-btn');
    const quizProgress = document.getElementById('quiz-progress');

    let mode = 'chat';
    let questionBank = [];
    let questionBankLoaded = false;
    let currentQuestion = null;
    let currentMatches = [];
    let currentIndex = -1;

    let profiles = readJsonStorage(PROFILE_STORAGE_KEY, []);
    let progressByPerson = readJsonStorage(PROGRESS_STORAGE_KEY, {});

    function renderKatex(node) {
        if (typeof renderMath === 'function') {
            renderMath(node);
        }
    }

    function saveProfiles() {
        writeJsonStorage(PROFILE_STORAGE_KEY, profiles);
    }

    function saveProgress() {
        writeJsonStorage(PROGRESS_STORAGE_KEY, progressByPerson);
    }

    function ensureProfiles() {
        if (!profiles.length) {
            profiles = [
                {
                    id: `person-${Date.now()}`,
                    name: 'Me',
                },
            ];
            saveProfiles();
        }
        if (!progressByPerson || typeof progressByPerson !== 'object') {
            progressByPerson = {};
            saveProgress();
        }
    }

    function fillSelect(select, values, { includeAll = true, allLabel = 'All' } = {}) {
        const previousValue = select.value;
        select.innerHTML = '';
        if (includeAll) {
            select.appendChild(createOptionNode('', allLabel));
        }
        values.forEach((value) => {
            select.appendChild(createOptionNode(value, value));
        });
        if (previousValue && Array.from(select.options).some((option) => option.value === previousValue)) {
            select.value = previousValue;
        }
    }

    function populateProfiles() {
        ensureProfiles();
        const previousValue = personSelect.value;
        personSelect.innerHTML = '';
        profiles.forEach((profile) => {
            const option = createOptionNode(profile.id, profile.name);
            personSelect.appendChild(option);
        });
        personSelect.value = previousValue && profiles.some((profile) => profile.id === previousValue) ? previousValue : profiles[0].id;
    }

    function getAnsweredMap() {
        const personId = personSelect.value;
        if (!personId) {
            return {};
        }
        progressByPerson[personId] ||= {};
        return progressByPerson[personId];
    }

    function answeredCount(records) {
        const answeredMap = getAnsweredMap();
        return records.filter((record) => answeredMap[record.record_id]).length;
    }

    function verifiedQuestions() {
        return questionBank.filter(
            (record) =>
                record.correct_option &&
                Array.isArray(record.options) &&
                record.options.filter((option) => (option.text || '').trim()).length >= 2
        );
    }

    function updateBankSummary() {
        if (!questionBankLoaded) {
            bankSummary.textContent = 'Loading question bank...';
            if (bankStatus) {
                bankStatus.textContent = 'Structured question bank: loading...';
            }
            return;
        }

        const verified = verifiedQuestions().length;
        const unresolved = questionBank.length - verified;
        bankSummary.textContent = `${questionBank.length} questions ready, ${verified} quiz-verified`;
        if (bankStatus) {
            bankStatus.textContent = `Structured question bank: ${questionBank.length} questions loaded. ${unresolved} still need verified answer sources, so they stay available in Ask AI mode instead of graded quiz mode.`;
        }
    }

    function filterQuestions({ includeUnverified = false } = {}) {
        const topicNeedle = topicFilter.value.trim().toLowerCase();
        return questionBank.filter((record) => {
            if (!includeUnverified && (!record.correct_option || !record.options || record.options.length < 2)) {
                return false;
            }
            if (yearFilter.value && String(record.year || '') !== yearFilter.value) {
                return false;
            }
            if (dateFilter.value && record.date_label !== dateFilter.value) {
                return false;
            }
            if (shiftFilter.value && (record.shift || '') !== shiftFilter.value) {
                return false;
            }
            if (subjectFilter.value && record.subject !== subjectFilter.value) {
                return false;
            }
            if (chapterFilter.value && record.chapter !== chapterFilter.value) {
                return false;
            }
            if (topicNeedle) {
                const haystack = `${record.topic || ''} ${record.question_text || ''}`.toLowerCase();
                if (!haystack.includes(topicNeedle)) {
                    return false;
                }
            }
            return true;
        });
    }

    function updateQuizProgress() {
        const filtered = filterQuestions();
        const answered = answeredCount(filtered);
        const person = profiles.find((profile) => profile.id === personSelect.value);
        const unresolved = questionBankLoaded ? questionBank.length - verifiedQuestions().length : 0;
        quizProgress.textContent = person
            ? `${person.name}: ${answered}/${filtered.length || 0} questions completed for the current filter. ${Math.max((filtered.length || 0) - answered, 0)} left. ${unresolved ? `${unresolved} questions are still analysis-only because their answers are not source-verified yet.` : ''}`
            : 'Pick a person to track quiz progress.';
    }

    function populateFilters() {
        fillSelect(yearFilter, sortText(new Set(questionBank.map((record) => String(record.year || '')).filter(Boolean))));
        fillSelect(dateFilter, sortText(new Set(questionBank.map((record) => record.date_label).filter(Boolean))));
        fillSelect(shiftFilter, sortText(new Set(questionBank.map((record) => record.shift).filter(Boolean))));
        fillSelect(subjectFilter, sortText(new Set(questionBank.map((record) => record.subject).filter(Boolean))));
        fillSelect(chapterFilter, sortText(new Set(questionBank.map((record) => record.chapter).filter(Boolean))));
        updateQuizProgress();
    }

    function ensureQuestionBank() {
        if (questionBankLoaded) {
            return Promise.resolve(questionBank);
        }

        updateBankSummary();

        return fetch('data/question_bank.json')
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Unable to load structured question bank.');
                }
                return response.json();
            })
            .then((data) => {
                questionBank = Array.isArray(data) ? data : [];
                questionBankLoaded = true;
                populateProfiles();
                populateFilters();
                updateBankSummary();
                return questionBank;
            })
            .catch((error) => {
                bankSummary.textContent = 'Question bank failed to load';
                if (bankStatus) {
                    bankStatus.textContent = error.message;
                }
                throw error;
            });
    }

    function setMode(nextMode) {
        mode = nextMode;
        const quizActive = mode === 'quiz';
        chatModeBtn.classList.toggle('active', !quizActive);
        quizModeBtn.classList.toggle('active', quizActive);
        quizPanel.hidden = !quizActive;
        promptInput.placeholder = quizActive
            ? 'Ask the AI about the current quiz question, or use the quiz controls above...'
            : 'E.g. collect electrostatics questions from 2024, or ask for a topic-wise analysis...';
        if (quizActive) {
            ensureQuestionBank().catch(() => {});
        }
    }

    function createMessageContainer() {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai-message';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content quiz-card';
        msgDiv.appendChild(contentDiv);
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return contentDiv;
    }

    function renderQuizCard(record) {
        currentQuestion = record;
        const contentDiv = createMessageContainer();
        const displayDate = record.date_label || 'Unknown date';
        const meta = [
            displayDate,
            record.shift,
            record.subject,
            record.chapter,
            record.topic,
        ].filter(Boolean);

        contentDiv.innerHTML = `
            <h3>Question ${record.question_number}</h3>
            <div class="quiz-meta">
                ${meta.map((value) => `<span class="quiz-chip">${escapeHtml(value)}</span>`).join('')}
            </div>
            <div class="quiz-question"></div>
            <div class="quiz-options"></div>
        `;

        const questionNode = contentDiv.querySelector('.quiz-question');
        questionNode.textContent = record.question_text || record.text || 'Question text unavailable.';

        const optionsNode = contentDiv.querySelector('.quiz-options');
        record.options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'quiz-option';
            button.dataset.optionKey = option.key;
            button.innerHTML = `
                <span class="quiz-option-label">${escapeHtml(option.key)}</span>
                <span>${escapeHtml(option.text || 'Blank in extract')}</span>
            `;
            button.addEventListener('click', () => handleSelection(record, button, contentDiv));
            optionsNode.appendChild(button);
        });

        renderKatex(contentDiv);
    }

    function addRevealSection(record, isCorrect, selectedKey, contentDiv) {
        const reveal = document.createElement('div');
        reveal.className = 'quiz-reveal';
        const answerSource = record.answer_source;
        const sourceHtml = answerSource
            ? answerSource.url
                ? `<a class="source-link" href="${escapeHtml(answerSource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(answerSource.label)}</a>`
                : `${escapeHtml(answerSource.label)} (PDF pages ${escapeHtml((answerSource.pages || []).join(', '))})`
            : 'Answer source not attached yet.';

        reveal.innerHTML = `
            <div class="reveal-callout ${isCorrect ? 'correct' : 'wrong'}">
                ${isCorrect ? 'Correct answer selected.' : `Selected ${escapeHtml(selectedKey)}. Correct answer: ${escapeHtml(record.correct_option || 'Unavailable')}.`}
            </div>
            <div class="quiz-section">
                <h4>Answer Source</h4>
                <div>${sourceHtml}</div>
            </div>
            <div class="quiz-section">
                <h4>Key Concepts</h4>
                <ul>${(record.concepts || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>No concept notes attached yet.</li>'}</ul>
            </div>
            <div class="quiz-section">
                <h4>Linked Equations</h4>
                <ul>${(record.equations || []).map((item) => `<li>$$${escapeHtml(item)}$$</li>`).join('') || '<li>No equation note attached yet.</li>'}</ul>
            </div>
        `;
        contentDiv.appendChild(reveal);
        renderKatex(reveal);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function handleSelection(record, clickedButton, contentDiv) {
        const optionButtons = Array.from(contentDiv.querySelectorAll('.quiz-option'));
        const selectedKey = clickedButton.dataset.optionKey;
        const isCorrect = selectedKey === record.correct_option;
        const answeredMap = getAnsweredMap();

        optionButtons.forEach((button) => {
            button.disabled = true;
            const key = button.dataset.optionKey;
            if (key === record.correct_option) {
                button.classList.add('correct');
            }
            if (key === selectedKey && key !== record.correct_option) {
                button.classList.add('wrong');
            }
        });

        answeredMap[record.record_id] = {
            attempts: (answeredMap[record.record_id]?.attempts || 0) + 1,
            correct: isCorrect,
            selectedOption: selectedKey,
            completedAt: new Date().toISOString(),
        };
        saveProgress();
        updateQuizProgress();
        addRevealSection(record, isCorrect, selectedKey, contentDiv);
    }

    function chooseNextQuestion(matches) {
        const answeredMap = getAnsweredMap();
        const unanswered = matches.filter((record) => !answeredMap[record.record_id]);
        if (unanswered.length) {
            return unanswered[0];
        }
        currentIndex = (currentIndex + 1) % matches.length;
        return matches[currentIndex];
    }

    function startQuiz() {
        ensureQuestionBank()
            .then(() => {
                currentMatches = filterQuestions();
                currentIndex = -1;
                if (!currentMatches.length) {
                    quizProgress.textContent = 'No answer-verified questions match the current filter yet. Try relaxing the filters or switch back to Ask AI mode for unresolved papers.';
                    return;
                }
                const nextRecord = chooseNextQuestion(currentMatches);
                renderQuizCard(nextRecord);
                updateQuizProgress();
            })
            .catch(() => {});
    }

    function nextQuestion() {
        currentMatches = filterQuestions();
        if (!currentMatches.length) {
            quizProgress.textContent = 'No answer-verified questions match the current filter yet.';
            return;
        }
        const nextRecord = chooseNextQuestion(currentMatches);
        renderQuizCard(nextRecord);
    }

    function resetFilters() {
        yearFilter.value = '';
        dateFilter.value = '';
        shiftFilter.value = '';
        subjectFilter.value = '';
        chapterFilter.value = '';
        topicFilter.value = '';
        updateQuizProgress();
    }

    function maybeHandlePrompt(prompt) {
        const lower = prompt.toLowerCase();
        if (lower.includes('quiz mode') || lower.startsWith('start quiz')) {
            setMode('quiz');
            startQuiz();
            return true;
        }
        if ((lower.startsWith('next question') || lower.startsWith('skip question')) && mode === 'quiz') {
            nextQuestion();
            return true;
        }
        return false;
    }

    function augmentPrompt(prompt) {
        if (mode !== 'quiz' || !currentQuestion) {
            return prompt;
        }
        return `${prompt}\n\nCurrent quiz question context:\nDate: ${currentQuestion.date_label || currentQuestion.exam_info}\nQuestion Number: ${currentQuestion.question_number}\nQuestion: ${currentQuestion.question_text}\nOptions: ${currentQuestion.options.map((item) => `${item.key}. ${item.text}`).join(' | ')}`;
    }

    chatModeBtn.addEventListener('click', () => setMode('chat'));
    quizModeBtn.addEventListener('click', () => setMode('quiz'));
    addPersonBtn.addEventListener('click', () => {
        const name = window.prompt('Enter the person name to track quiz progress.');
        if (!name || !name.trim()) {
            return;
        }
        profiles.push({
            id: `person-${Date.now()}`,
            name: name.trim(),
        });
        saveProfiles();
        populateProfiles();
        personSelect.value = profiles.at(-1).id;
        updateQuizProgress();
    });
    personSelect.addEventListener('change', updateQuizProgress);
    [yearFilter, dateFilter, shiftFilter, subjectFilter, chapterFilter].forEach((select) => {
        select.addEventListener('change', updateQuizProgress);
    });
    topicFilter.addEventListener('input', updateQuizProgress);
    startQuizBtn.addEventListener('click', startQuiz);
    nextQuizBtn.addEventListener('click', nextQuestion);
    resetQuizBtn.addEventListener('click', resetFilters);

    populateProfiles();
    updateBankSummary();
    updateQuizProgress();

    return {
        ensureQuestionBank,
        setMode,
        getMode: () => mode,
        maybeHandlePrompt,
        augmentPrompt,
    };
}
