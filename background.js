// No TensorFlow imports needed - using rule-based approach
let modelReady = true; // Initialize as ready since no async loading needed

function loadAIModel() {
    // Simple rule-based approach - no external dependencies
    modelReady = true;
    console.log("AI Model Ready (rule-based approach)");
}

// Initialize immediately and on install
loadAIModel();

chrome.runtime.onInstalled.addListener(() => {
    loadAIModel();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Received request:", request);
    console.log("Model ready status:", modelReady);

    if (request.type === "analyzeText") {
        if (!modelReady) {
            console.error("AI Model is not ready yet.");
            sendResponse({ importance: "error" });
            return false;
        }

        try {
            // Rule-based approach to determine importance
            const text = request.text.toLowerCase();
            let importance = "неважливий";
            
            console.log(`Analyzing text: "${text}"`);
            
            // Ukrainian important keywords
            const importantKeywords = [
                // Purchase/order related
                'купити', 'buy', 'замовити', 'order', 'checkout', 'оформити', 'покупка',
                'додати в кошик', 'add to cart', 'cart', 'кошик',
                // Authentication related  
                'увійти', 'увійдіть', 'sign in', 'login', 'вхід', 'реєстрація', 'register', 'кабінет',
                // Form related
                'відправити', 'submit', 'надіслати', 'send', 'apply', 'застосувати',
                // Navigation
                'меню', 'menu', 'навігація', 'navigation', 'каталог', 'catalog',
                // Search/Filter related
                'знайти', 'find', 'search', 'пошук', 'filter', 'clear', 'очистити',
                // Common actions
                'зберегти', 'save', 'продовжити', 'continue', 'далі', 'next', 'cancel', 'скасувати'
            ];

            const importantPlaceholders = [
                'email', 'пошта', 'e-mail', 'електронна пошта',
                'password', 'пароль', 'pass',
                'name', "ім'я", 'імя', 'прізвище', 'surname',
                'phone', 'телефон', 'номер',
                'card', 'картка', 'карта', 'credit'
            ];

            // Check if text contains important keywords
            const allKeywords = [...importantKeywords, ...importantPlaceholders];
            for (const keyword of allKeywords) {
                if (text.includes(keyword)) {
                    importance = "важливий";
                    console.log(`Matched keyword: "${keyword}" in text: "${text}"`);
                    break;
                }
            }

            console.log(`AI result for "${request.text}": ${importance}`);
            sendResponse({ importance });
        } catch (error) {
            console.error("AI processing error:", error);
            console.error("Error stack:", error.stack);
            sendResponse({ importance: "error" });
        }

        return false; // Synchronous response
    }

    return false;
});
