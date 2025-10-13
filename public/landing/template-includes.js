// Simple include system for HTML files
async function loadInclude(elementId, filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load ${filePath}: ${response.status}`);
    }
    const html = await response.text();
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = html;
    } else {
      console.error(`Element with id '${elementId}' not found`);
    }
  } catch (error) {
    console.error('Error loading include:', error);
  }
}

// Load all includes when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
  // Load all HTML includes
  await Promise.all([
    loadInclude('header-include', '/landing/includes/header-template.html'),
    loadInclude('hero-include', '/landing/includes/hero-section.html'), 
    loadInclude('download-include', '/landing/includes/download-section.html'),
    loadInclude('emergency-include', '/landing/includes/emergency-services.html'),
    loadInclude('content-include', '/landing/includes/content-sections.html'),
    loadInclude('footer-include', '/landing/includes/footer-template.html')
  ]);

  // Initialize mobile menu and animations after includes are loaded
  initializeMobileMenu();
  initializeAnimations();
});

function initializeMobileMenu() {
  const mobileMenuButton = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");
  
  if (mobileMenuButton && mobileMenu) {
    let isMenuOpen = false;
    
    mobileMenuButton.addEventListener("click", () => {
      isMenuOpen = !isMenuOpen;
      if (isMenuOpen) {
        mobileMenu.classList.remove("-translate-x-full");
      } else {
        mobileMenu.classList.add("-translate-x-full");
      }
    });
  }
}

function initializeAnimations() {
  // Player counter animation
  function animateCounter(counter) {
    const target = 250;
    const duration = 2000;
    const step = target / (duration / 16);
    let current = 0;

    const updateCounter = () => {
      current += step;
      if (current >= target) {
        counter.textContent = target;
      } else {
        counter.textContent = Math.floor(current);
        requestAnimationFrame(updateCounter);
      }
    };
    updateCounter();
  }

  // Player counter intersection observer
  const playerCounterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const counter = document.getElementById("playerCounter");
          if (counter) {
            animateCounter(counter);
          }
        }
      });
    },
    { threshold: 0.1 }
  );

  // Logo animation observer
  const logoObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("animate-logo-appear");
        } else {
          entry.target.classList.remove("animate-logo-appear");
        }
      });
    },
    { threshold: 0.2 }
  );

  // Initialize observers
  const counter = document.getElementById("playerCounter");
  if (counter) {
    playerCounterObserver.observe(counter);
  }

  const animatedElements = document.querySelectorAll(".anim-on-scroll");
  animatedElements.forEach((el) => {
    logoObserver.observe(el);
  });
}
