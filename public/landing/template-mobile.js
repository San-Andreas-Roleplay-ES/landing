// Mobile menu functionality
const mobileMenuButton = document.getElementById("mobile-menu-button");
const mobileMenu = document.getElementById("mobile-menu");
let isMenuOpen = false;

mobileMenuButton.addEventListener("click", () => {
  isMenuOpen = !isMenuOpen;
  if (isMenuOpen) {
    mobileMenu.classList.remove("-translate-x-full");
  } else {
    mobileMenu.classList.add("-translate-x-full");
  }
});
