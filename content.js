// Oopski - Chrome Extension for Interactive User Guides with AI-enhanced Page Analysis

// Content script to create step-by-step user guides with automatic element detection using AI
(function() {
    function analyzeTextWithAI(text) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error(`AI analysis timeout for text: ${text}`);
                reject("timeout");
            }, 5000); // 5-second timeout

            chrome.runtime.sendMessage({ type: "analyzeText", text: text }, response => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    console.error(`Error sending message: ${chrome.runtime.lastError.message}`);
                    reject(chrome.runtime.lastError.message);
                } else if (!response) {
                    console.error("No response received from background.js");
                    reject("no response");
                } else {
                    console.log(`AI response for text '${text}': ${response.importance}`);
                    resolve(response.importance);
                }
            });
        });
    }

    async function analyzePage() {
        let detectedElements = [];
        let tasks = [];

        // Визначення основних кнопок (купити, додати в кошик, оформити замовлення, увійти)
        const buttons = document.querySelectorAll("button, input[type='submit']");
        for (const button of buttons) {
            const text = button.innerText.toLowerCase().trim();
            if (text) { // Skip empty text
                tasks.push(
                    analyzeTextWithAI(text).then(importance => {
                        if (importance === "важливий") {
                            detectedElements.push({ selector: getElementSelector(button), message: `Ця кнопка (${text}) є важливою.` });
                        }
                    }).catch(error => console.error(`Error analyzing button '${text}':`, error))
                );
            }
        }

        // Визначення основних полів введення (пошта, пароль, номер картки)
        const inputs = document.querySelectorAll("input");
        for (const input of inputs) {
            const placeholder = input.placeholder ? input.placeholder.toLowerCase().trim() : '';
            if (placeholder) { // Skip empty placeholder
                tasks.push(
                    analyzeTextWithAI(placeholder).then(importance => {
                        if (importance === "важливий") {
                            detectedElements.push({ selector: getElementSelector(input), message: `Це поле (${placeholder}) є важливим.` });
                        }
                    }).catch(error => console.error(`Error analyzing input '${placeholder}':`, error))
                );
            }
        }

        // Чекаємо, поки всі асинхронні запити завершаться
        await Promise.all(tasks).catch(error => console.error("Error in analyzePage:", error));
        return detectedElements;
    }

    function getElementSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        } else if (element.className) {
            return `.${element.className.split(" ").join(".")}`;
        } else {
            return element.tagName.toLowerCase();
        }
    }

    function showStep(step, callback = null) {
        waitForElement(step.selector, (element) => {
            // Не видаляємо існуючі підказки - показуємо всі одночасно
            // Перевіряємо, чи вже є підказка для цього селектора
            const escapedSelector = step.selector.replace(/"/g, '\\"');
            const existingHint = document.querySelector(`.oopski-hint[data-selector="${escapedSelector}"]`);
            if (existingHint) {
                console.log(`Підказка для ${step.selector} вже існує`);
                return; // Підказка вже є для цього елемента
            }

            const hint = document.createElement("div");
            hint.className = "oopski-hint";
            hint.dataset.selector = step.selector; // Унікальний ідентифікатор
            // hint.style.position = "absolute";
            hint.style.background = "linear-gradient(135deg, #ffd700, #ffed4e)";
            hint.style.padding = "10px 15px";
            hint.style.borderRadius = "8px";
            hint.style.fontSize = "14px";
            hint.style.fontFamily = "Arial, sans-serif";
            hint.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
            hint.style.zIndex = "10000";
            hint.style.marginBottom = "5px";
            hint.style.border = "2px solid #ffcc00";
            hint.style.color = "#333";
            hint.style.maxWidth = "300px";
            hint.style.cursor = "pointer";

            // Створення контейнера для тексту та кнопки
            const messageContainer = document.createElement("div");
            messageContainer.style.display = "flex";
            messageContainer.style.justifyContent = "space-between";
            messageContainer.style.alignItems = "center";
            messageContainer.style.gap = "10px";

            const messageText = document.createElement("span");
            messageText.textContent = step.message;
            messageText.style.flex = "1";

            const closeButton = document.createElement("button");
            closeButton.textContent = "✕";
            closeButton.style.background = "rgba(0, 0, 0, 0.1)";
            closeButton.style.border = "none";
            closeButton.style.borderRadius = "50%";
            closeButton.style.width = "20px";
            closeButton.style.height = "20px";
            closeButton.style.cursor = "pointer";
            closeButton.style.fontSize = "12px";
            closeButton.style.color = "#666";
            closeButton.style.display = "flex";
            closeButton.style.alignItems = "center";
            closeButton.style.justifyContent = "center";

            messageContainer.appendChild(messageText);
            messageContainer.appendChild(closeButton);
            hint.appendChild(messageContainer);

            element.insertAdjacentElement("beforebegin", hint);

            // Обробник для кнопки закриття
            closeButton.addEventListener("click", (e) => {
                e.stopPropagation();
                hint.remove();
            });

            // Обробник для закриття по кліку на всю підказку
            hint.addEventListener("click", () => {
                hint.remove();
            });

            // Додати анімацію появи
            hint.style.opacity = "0";
            hint.style.transform = "scale(0.8)";
            hint.style.transition = "all 0.3s ease";
            
            setTimeout(() => {
                hint.style.opacity = "1";
                hint.style.transform = "scale(1)";
            }, 10);


        });
    }

    async function runAutoGuide() {
        const detectedSteps = await analyzePage();
        if (detectedSteps.length > 0) {
            console.log(`Показуємо ${detectedSteps.length} підказок одночасно`);
            // Показуємо всі підказки одночасно
            detectedSteps.forEach((step, index) => {
                showStep(step);
            });
        } else {
            console.log("Важливих елементів не знайдено");
        }
    }

    function waitForElement(selector, callback) {
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                callback(element);
                obs.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    runAutoGuide();
})();
