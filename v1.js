// Oopski - Chrome Extension for Interactive User Guides

// Content script to create step-by-step user guides
(function() {
    const scenarios = {
        "login": {
            urls: ["/login", "/signin"],
            steps: [
                { selector: "input[type='email']", message: "Введіть свою електронну пошту." },
                { selector: "input[type='password']", message: "Введіть свій пароль." },
                { selector: "button[type='submit']", message: "Натисніть, щоб увійти." }
            ]
        },
        "checkout": {
            urls: ["/checkout", "/cart", "/payment"],
            steps: [
                { selector: "#customer-name", message: "Введіть вашу адресу доставки." },
                { selector: "#customer-lastname", message: "Введіть номер вашої картки." },
                { selector: "#customer-telephone", message: "Підтвердіть замовлення." }
            ]
        }
    };

    function detectScenario() {
        const currentUrl = window.location.pathname.toLowerCase();
        for (const [scenario, data] of Object.entries(scenarios)) {
            if (data.urls.some(url => currentUrl.includes(url))) {
                return scenario;
            }
        }
        return null;
    }

    function waitForElement(selector, callback) {
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                callback(element);
                obs.disconnect(); // Зупиняємо спостереження після знаходження елемента
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function showStep(step, callback) {
        waitForElement(step.selector, (element) => {
            // Видаляємо попередню підказку
            const existingHint = document.querySelector(".oopski-hint");
            if (existingHint) {
                existingHint.remove();
            }

            // Створюємо нову підказку
            const hint = document.createElement("div");
            hint.textContent = step.message;
            hint.className = "oopski-hint";
            hint.style.position = "absolute";
            hint.style.background = "yellow";
            hint.style.padding = "5px";
            hint.style.borderRadius = "5px";
            hint.style.fontSize = "14px";
            hint.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.2)";
            hint.style.zIndex = "1000";
            hint.style.marginBottom = "5px";
            element.insertAdjacentElement("beforebegin", hint);

            // Переходимо до наступного кроку після 3 секунд
            setTimeout(() => {
                hint.remove(); // Видаляємо підказку перед наступним кроком
                callback();
            }, 3000);
        });
    }


    function runScenario() {
        const scenario = detectScenario();

        console.log("Scenario detected:", scenario);
        if (scenario && scenarios[scenario]) {
            let stepIndex = 0;
            function nextStep() {
                if (stepIndex < scenarios[scenario].steps.length) {
                    showStep(scenarios[scenario].steps[stepIndex]);
                    stepIndex++;
                    setTimeout(nextStep, 3000); // Move to the next step after 3 seconds
                }
            }
            nextStep();
        }
    }

    runScenario();
})();
