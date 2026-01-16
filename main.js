// main.js
// AI Learning Assistant - Full rewrite for DeepSeek backend

// ==================== Global Variables ====================
let currentSubject = '';
let conversationHistory = [];
let currentImageBase64 = null;
let currentImageFilename = null;

let messageInput, sendButton, quizButton, imageUpload, chatHistory;
let subjectButtons = [];
let imagePreviewContainer = null;

// ==================== Initialization ====================
document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("memoryResult");
    if (el) el.classList.add("hidden");
    
    initializeChatElements();
    setupEventListeners();
    setupSubjectButtons();
    
    const fullscreenBtn = document.getElementById("fullscreenBtn");
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", toggleFullscreen);
    }
    
    const importBtn = document.getElementById("importBtn");
    if (importBtn) {
        importBtn.addEventListener("click", () => {
            document.getElementById("importFile").click();
        });
    }
    
    const importFile = document.getElementById("importFile");
    if (importFile) {
        importFile.addEventListener("change", importData);
    }
    
    initializeMarkdownRenderer();
    console.log("AI Learning Assistant initialized");
});

function initializeChatElements() {
    messageInput = document.getElementById("messageInput");
    sendButton = document.getElementById("sendButton");
    quizButton = document.getElementById("quizButton");
    imageUpload = document.getElementById("imageUpload");
    chatHistory = document.getElementById("chatHistory");
    
    createImagePreviewContainer();
}

function createImagePreviewContainer() {
    if (!document.getElementById("imagePreviewContainer") && messageInput && messageInput.parentNode) {
        imagePreviewContainer = document.createElement("div");
        imagePreviewContainer.id = "imagePreviewContainer";
        imagePreviewContainer.className = "image-preview-container hidden";
        imagePreviewContainer.innerHTML = `
            <div class="image-preview-header">
                <span>Uploaded Image</span>
                <button id="removeImageBtn" class="remove-image-btn">&times;</button>
            </div>
            <img id="previewImage" src="" alt="Preview">
        `;
        
        const parent = messageInput.parentNode;
        parent.insertBefore(imagePreviewContainer, messageInput);
        
        const removeBtn = document.getElementById("removeImageBtn");
        if (removeBtn) {
            removeBtn.addEventListener("click", clearImage);
        }
    }
}

function setupEventListeners() {
    if (sendButton) {
        sendButton.addEventListener("click", sendMessage);
    }
    
    if (messageInput) {
        messageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    
    if (quizButton) {
        quizButton.addEventListener("click", startQuizMode);
    }
    
    if (imageUpload) {
        imageUpload.addEventListener("change", handleImageUpload);
    }
}

function setupSubjectButtons() {
    const buttons = document.querySelectorAll(".subject-btn");
    subjectButtons = Array.from(buttons);
    
    subjectButtons.forEach(button => {
        button.addEventListener("click", () => {
            subjectButtons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");
            currentSubject = button.dataset.subject || "";
            
            restoreConversationHistory();
            console.log(`Subject switched: ${currentSubject}`);
        });
        
        if (button.classList.contains("active")) {
            currentSubject = button.dataset.subject || "";
            restoreConversationHistory();
        }
    });
}

// ==================== Chat Functions ====================

async function sendMessage() {
    const message = messageInput ? messageInput.value.trim() : "";
    if (!message && !currentImageBase64) {
        alert("Please enter a message or upload an image");
        return;
    }
    
    if (messageInput) {
        messageInput.value = "";
    }
    
    addMessageToChat("user", message, currentImageBase64);
    
    const imageData = currentImageBase64;
    const imageFilename = currentImageFilename;
    
    clearImage();
    showLoadingState();
    
    try {
        const apiKeyObj = getApiKeysFromStorage();
        const apiKeyList = Object.values(apiKeyObj);
        
        const requestData = {
            message: message,
            api_keys: apiKeyList,
            mode: "chat",
            conversation_history: conversationHistory,
        };
        
        let apiEndpoint = "";
        if (imageData) {
            if (!currentSubject) {
                alert("Please select a subject first");
                removeLoadingState();
                return;
            }
            apiEndpoint = `/api/process_image_with_agent/${currentSubject}`;
            requestData.image = imageData;
            requestData.image_filename = imageFilename;
        } else {
            if (!currentSubject) {
                alert("Please select a subject first");
                removeLoadingState();
                return;
            }
            apiEndpoint = `/api/chat/${currentSubject}`;
        }
        
        const response = await fetchWithRetry(apiEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        removeLoadingState();
        
        let assistantResponse = data.response || "";
        let ocrText = data.ocr_text || "";
        
        if (ocrText) {
            const ocrHint = '<div class="ocr-hint">[Auto-recognized text from image]</div>';
            assistantResponse = ocrHint + assistantResponse;
        }
        
        addMessageToChat("assistant", assistantResponse);
        updateConversationHistory(message, imageData, assistantResponse);
        
    } catch (error) {
        console.error("Send message failed:", error);
        removeLoadingState();
        addMessageToChat("assistant", `Failed to send message: ${error.message}. Please check network or API key settings.`);
    }
}

async function startQuizMode() {
    if (!currentSubject) {
        alert("Please select a subject first");
        return;
    }
    
    showLoadingState();
    
    try {
        const apiKeyObj = getApiKeysFromStorage();
        const apiKeyList = Object.values(apiKeyObj);
        
        const requestData = {
            message: "Start smart quiz",
            api_keys: apiKeyList,
            mode: "quiz",
            conversation_history: [],
        };
        
        const response = await fetchWithRetry(`/api/chat/${currentSubject}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        removeLoadingState();
        
        if (data.response) {
            addMessageToChat("assistant", data.response);
            updateConversationHistory("Start smart quiz", null, data.response);
        }
        
    } catch (error) {
        console.error("Start quiz failed:", error);
        removeLoadingState();
        addMessageToChat("assistant", `Failed to start quiz: ${error.message}. Please check network or API key settings.`);
    }
}

// ==================== Network Retry Logic ====================

async function fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) return response;
            if (i === retries - 1) throw new Error(`Request failed: ${response.status}`);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`Request timeout (attempt ${i + 1}/${retries})`);
            } else {
                console.warn(`Request failed (attempt ${i + 1}/${retries}):`, error);
            }
            
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// ==================== Image Handling ====================

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.match("image.*")) {
        alert("Please select an image file (JPEG, PNG, GIF, etc.)");
        clearFileInput(event.target);
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        alert("Image size must not exceed 5MB");
        clearFileInput(event.target);
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const base64Data = e.target.result;
            currentImageBase64 = base64Data;
            currentImageFilename = file.name;
            showImagePreview(base64Data);
            console.log(`Image uploaded: ${file.name}, size: ${(file.size / 1024).toFixed(2)}KB`);
        } catch (error) {
            console.error("Image processing failed:", error);
            alert("Failed to process image, please try again");
            clearFileInput(event.target);
        }
    };
    
    reader.onerror = function() {
        console.error("Failed to read image file");
        alert("Failed to read image file, please try again");
        clearFileInput(event.target);
    };
    
    reader.readAsDataURL(file);
}

function showImagePreview(base64Data) {
    if (!imagePreviewContainer) {
        createImagePreviewContainer();
    }
    
    if (imagePreviewContainer) {
        const previewImage = document.getElementById("previewImage");
        if (previewImage) {
            previewImage.src = base64Data;
            imagePreviewContainer.classList.remove("hidden");
        }
    }
}

function clearImage() {
    currentImageBase64 = null;
    currentImageFilename = null;
    
    if (imagePreviewContainer) {
        imagePreviewContainer.classList.add("hidden");
        const previewImage = document.getElementById("previewImage");
        if (previewImage) {
            previewImage.src = "";
        }
    }
    
    if (imageUpload) {
        imageUpload.value = "";
    }
}

function clearFileInput(input) {
    try {
        input.value = "";
        if (input.value) {
            input.type = "text";
            input.type = "file";
        }
    } catch (e) {
        console.warn("Error clearing file input:", e);
    }
}

// ==================== Utility Functions ====================

function getApiKeysFromStorage() {
    try {
        const apiKeys = localStorage.getItem("apiKeys");
        if (apiKeys) {
            return JSON.parse(apiKeys);
        }
    } catch (error) {
        console.error("Failed to read API Keys from localStorage:", error);
    }
    return {};
}

function addMessageToChat(role, content, imageBase64 = null) {
    if (!chatHistory) return;
    
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${role}-message`;
    
    let messageContent = "";
    
    if (imageBase64 && role === "user") {
        messageContent += `<div class="message-image"><img src="${imageBase64}" alt="Uploaded image"></div>`;
    }
    
    if (content) {
        messageContent += `<div class="message-text">${formatMessageContent(content)}</div>`;
    }
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-role">${role === "user" ? "You" : "AI Assistant"}</span>
        </div>
        <div class="message-content">${messageContent}</div>
    `;
    
    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    if (role === "assistant") {
        renderMarkdownInMessage(messageDiv);
    }
}

function formatMessageContent(content) {
    let escaped = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    
    escaped = escaped.replace(/\n/g, "<br>");
    return escaped;
}

function updateConversationHistory(userMessage, imageBase64, assistantResponse) {
    let userContent = userMessage;
    if (imageBase64) {
        userContent += " [with image]";
    }
    
    conversationHistory.push({
        role: "user",
        content: userContent
    });
    
    conversationHistory.push({
        role: "assistant",
        content: assistantResponse
    });
    
    if (conversationHistory.length > 40) {
        conversationHistory = conversationHistory.slice(-40);
    }
    
    saveConversationHistory();
}

function saveConversationHistory() {
    if (!currentSubject) return;
    
    try {
        localStorage.setItem(`chat_history_${currentSubject}`, 
                            JSON.stringify(conversationHistory));
    } catch (e) {
        console.warn("Failed to save conversation history:", e);
    }
}

function restoreConversationHistory() {
    if (!currentSubject) return;
    
    try {
        const saved = localStorage.getItem(`chat_history_${currentSubject}`);
        if (saved) {
            conversationHistory = JSON.parse(saved);
            console.log(`Restored ${conversationHistory.length} messages for ${currentSubject}`);
        } else {
            conversationHistory = [];
        }
    } catch (e) {
        console.warn("Failed to restore conversation history:", e);
        conversationHistory = [];
    }
}

function showLoadingState() {
    if (!chatHistory) return;
    
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "message assistant-message loading";
    loadingDiv.id = "loadingMessage";
    loadingDiv.innerHTML = `
        <div class="message-header">
            <span class="message-role">AI Assistant</span>
        </div>
        <div class="message-content">
            <div class="loading-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        </div>
    `;
    
    chatHistory.appendChild(loadingDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function removeLoadingState() {
    const loadingDiv = document.getElementById("loadingMessage");
    if (loadingDiv && loadingDiv.parentNode) {
        loadingDiv.parentNode.removeChild(loadingDiv);
    }
}

// ==================== Markdown Rendering ====================

function initializeMarkdownRenderer() {
}

function renderMarkdownInMessage(messageElement) {
}

// ==================== Original Features ====================

async function viewMemory() {
  const subj = document.getElementById("memorySubject").value;
  const res = await fetch(`/api/get_memory/${subj}`);
  if (!res.ok) {
    alert("Failed to get memory");
    return;
  }
  const data = await res.json();
  const el = document.getElementById("memoryResult");
  el.classList.remove("hidden");
  el.textContent = JSON.stringify(data.memory || [], null, 2);
}

async function exportMemory() {
  const subj = document.getElementById("memorySubject").value;
  const res = await fetch(`/api/get_memory/${subj}`);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data.memory || [], null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `memory_${subj}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportWrong() {
  const subj = document.getElementById("memorySubject").value;
  const res = await fetch(`/api/get_wrong_questions/${subj}`);
  
  if (!res.ok) {
    alert("Failed to get wrong questions");
    return;
  }
  
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data.wrong_questions || [], null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wrong_${subj}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== Fullscreen ====================

function toggleFullscreen() {
    const elem = document.documentElement;
    
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// ==================== Import ====================

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (fileExtension !== 'json') {
        alert("Please select a JSON file");
        clearFileInput(event.target);
        return;
    }
    
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        let endpoint = "";
        let message = "";
        
        if (file.name.includes('memory_')) {
            endpoint = "/api/import_memory";
            message = "Memory data";
        } else if (file.name.includes('wrong_')) {
            endpoint = "/api/import_wrong_questions";
            message = "Wrong questions data";
        } else {
            alert("Unrecognized file format");
            clearFileInput(event.target);
            return;
        }
        
        const fileName = file.name.replace(/\.[^/.]+$/, "");
        const subject = fileName.split('_').pop();
        
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                subject: subject,
                data: data
            })
        });
        
        if (!response.ok) {
            throw new Error(`Import failed: ${response.status}`);
        }
        
        const result = await response.json();
        alert(`${message} imported successfully: ${result.message}`);
        
    } catch (error) {
        console.error("Import failed:", error);
        alert(`Import failed: ${error.message}`);
    } finally {
        clearFileInput(event.target);
    }
}

// ==================== Keyboard Shortcuts ====================

document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        sendMessage();
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (messageInput) {
            messageInput.value = "";
        }
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        clearImage();
    }
});

// ==================== Network Status ====================

function checkNetworkStatus() {
    if (!navigator.onLine) {
        addMessageToChat("system", "Network connection lost. Please check network settings.");
    }
}

window.addEventListener("online", () => {
    addMessageToChat("system", "Network connection restored.");
});

window.addEventListener("offline", () => {
    addMessageToChat("system", "Network connection lost.");
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        console.log("Page reactivated");
    }
});

// ==================== Performance Optimization ====================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ==================== Debug Export ====================

if (window.DEBUG_MODE) {
    window.app = {
        sendMessage,
        startQuizMode,
        viewMemory,
        exportMemory,
        exportWrong,
        toggleFullscreen,
        importData,
        clearImage,
        getApiKeysFromStorage,
        addMessageToChat,
        updateConversationHistory,
        conversationHistory,
        currentSubject
    };
}

console.log("main.js loaded - all features ready");
