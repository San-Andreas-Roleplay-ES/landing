// Player counter animation
function animateCounter(counter) {
  const target = 250;
  const duration = 2000; // 2 segundos
  const step = target / (duration / 16); // 60fps
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
        animateCounter(counter);
      }
    });
  },
  {
    threshold: 0.1,
  }
);

// Logo animation on scroll
document.addEventListener("DOMContentLoaded", () => {
  // Initialize player counter observer
  const counter = document.getElementById("playerCounter");
  if (counter) {
    playerCounterObserver.observe(counter);
  }

  // Logo animation observer
  const animatedElements = document.querySelectorAll(".anim-on-scroll");
  
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

  animatedElements.forEach((el) => {
    logoObserver.observe(el);
  });
});
