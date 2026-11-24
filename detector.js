// Oopski - Chrome Extension for Interactive User Guides with Basic Page Analysis

// Content script to create step-by-step user guides with automatic element detection
(function() {
    function analyzePage() {
        let detectedElements = [];

        // Визначення основних кнопок (купити, додати в кошик, оформити замовлення, увійти)
        const buttons = document.querySelectorAll("button, input[type='submit']");
        buttons.forEach(button => {
            const text = button.innerText.toLowerCase();
            if (text.includes("купити") || text.includes("buy") || text.includes("order") || text.includes("checkout")) {
                detectedElements.push({ selector: getElementSelector(button), message: "Ця кнопка дозволяє оформити покупку." });
            }
            if (text.includes("увійти") || text.includes("sign in") || text.includes("login")) {
                detectedElements.push({ selector: getElementSelector(button), message: "Ця кнопка призначена для входу в систему." });
            }
        });

        // Визначення основних полів введення (пошта, пароль, номер картки)
        const inputs = document.querySelectorAll("input");
        inputs.forEach(input => {
            if (input.type === "email" || input.name.toLowerCase().includes("email")) {
                detectedElements.push({ selector: getElementSelector(input), message: "Тут потрібно ввести вашу електронну пошту." });
            }
            if (input.type === "password" || input.name.toLowerCase().includes("password")) {
                detectedElements.push({ selector: getElementSelector(input), message: "Тут потрібно ввести ваш пароль." });
            }
            if (input.name.toLowerCase().includes("card") || input.placeholder.toLowerCase().includes("card")) {
                detectedElements.push({ selector: getElementSelector(input), message: "Тут потрібно ввести номер вашої картки." });
            }
        });

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

    function showStep(step, callback) {
        waitForElement(step.selector, (element) => {
            const existingHint = document.querySelector(".oopski-hint");
            if (existingHint) {
                existingHint.remove();
            }

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

            setTimeout(() => {
                hint.remove();
                callback();
            }, 3000);
        });
    }

    function runAutoGuide() {
        const detectedSteps = analyzePage();
        if (detectedSteps.length > 0) {
            let stepIndex = 0;
            function nextStep() {
                if (stepIndex < detectedSteps.length) {
                    showStep(detectedSteps[stepIndex], nextStep);
                    stepIndex++;
                }
            }
            nextStep();
        }
    }

    runAutoGuide();
})();
