// Banking and payment sites are out of scope for v1: their pages hold the most
// sensitive data and a wrong hint there costs the most.

const BLOCKED_HOSTS = [
    "paypal.com",
    "stripe.com",
    "wise.com",
    "revolut.com",
    "n26.com",
    "monobank.ua",
    "privat24.ua",
    "privatbank.ua",
    "liqpay.ua",
    "wayforpay.com",
    "portmone.com.ua",
    "klarna.com",
    "adyen.com",
];

/** Returns a message for the person when the page must not be read, or null when it may be. */
export function blockReason(url: string, extraHosts: string[]): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return "Не вдалося прочитати адресу сторінки.";
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        return "Це службова сторінка браузера — розширення тут не працюють.";
    }

    const host = parsed.hostname.toLowerCase();
    const listed = [...BLOCKED_HOSTS, ...extraHosts]
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
    // Most banks carry the word in their domain; a rare false positive is acceptable here.
    const looksLikeBank = host.includes("bank");

    if (listed || looksLikeBank) {
        return `Oopski не працює на банківських і платіжних сайтах (${host}).`;
    }
    return null;
}

export const PAYMENT_FIELDS_MESSAGE =
    "На сторінці є поля для платіжної картки, тому Oopski її не читає. Продовжуй тут самостійно.";
