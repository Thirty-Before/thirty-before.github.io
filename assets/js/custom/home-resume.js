(function () {
  const interactiveSelector = "a, button, input, textarea, select, label";

  function initAuthorCard() {
    document.querySelectorAll("[data-resume-link]").forEach((card) => {
      let navigating = false;

      const navigate = () => {
        const target = card.dataset.resumeLink;
        if (!target || navigating) return;

        navigating = true;
        window.location.assign(target);
      };

      card.addEventListener("click", (event) => {
        if (event.target.closest(interactiveSelector)) return;
        navigate();
      });

      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest(interactiveSelector)) return;
        event.preventDefault();
        navigate();
      });
    });
  }

  function revealResume() {
    const reveal = document.querySelector("[data-resume-reveal]");
    if (!reveal) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => reveal.classList.add("is-visible"));
    });
  }

  function init() {
    initAuthorCard();
    revealResume();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
