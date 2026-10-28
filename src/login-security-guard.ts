/* Security hardening for the login screen.
   Never expose the default/demo PIN on the lock screen or error messages. */

const DEFAULT_PIN_PATTERNS = ["รหัสชั่วคราว", "รหัสชั่วคราวเริ่มต้น", "ใช้รหัสชั่วคราว", "1234"];
const SAFE_PIN_ERROR = "PIN ไม่ถูกต้อง กรุณาตรวจสอบรหัสอีกครั้ง";

const shouldHidePinHint = (text: string) => DEFAULT_PIN_PATTERNS.some(pattern => text.includes(pattern));

const sanitizeLoginScreen = () => {
  if (typeof document === "undefined") return;
  const loginCard = document.querySelector(".login-card");
  if (!loginCard) return;

  loginCard.querySelectorAll<HTMLElement>(".warning, .error-message, p, div, span").forEach(element => {
    const text = element.textContent || "";
    if (!shouldHidePinHint(text)) return;

    if (element.classList.contains("error-message") || text.includes("PIN ไม่ถูกต้อง")) {
      element.textContent = SAFE_PIN_ERROR;
      element.removeAttribute("title");
      return;
    }

    element.style.display = "none";
    element.setAttribute("aria-hidden", "true");
  });
};

if (typeof window !== "undefined") {
  sanitizeLoginScreen();
  const observer = new MutationObserver(() => sanitizeLoginScreen());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener("focus", sanitizeLoginScreen);
  window.addEventListener("pageshow", sanitizeLoginScreen);
}
