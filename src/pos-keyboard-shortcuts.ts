const closeUnknownProductModal = () => {
  const modals = Array.from(document.querySelectorAll<HTMLElement>(".grocery-modal"));
  const unknownModal = modals.find(modal => modal.querySelector(".grocery-unknown-code"));
  if (!unknownModal) return false;
  unknownModal.querySelector<HTMLButtonElement>('header button[aria-label="ปิด"], header button')?.click();
  return true;
};

window.addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== "Escape") return;
  if (!closeUnknownProductModal()) return;
  event.preventDefault();
  event.stopPropagation();
}, true);

export {};
