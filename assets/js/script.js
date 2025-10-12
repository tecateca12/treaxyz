document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                const headerOffset = 90; // Ajusta este valor si el header cambia de tamaño
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
});

const nav = document.querySelector("#primary-navigation");
const navToggle = document.querySelector(".menu-toggle");

navToggle.addEventListener("click", () => {
    // Verifica el estado actual del atributo 'data-visible'
    const visibility = nav.getAttribute("data-visible");

    if (visibility === "false") {
        // Abre el menú
        nav.setAttribute("data-visible", true);
        navToggle.setAttribute("aria-expanded", true);
    } else {
        // Cierra el menú
        nav.setAttribute("data-visible", false);
        navToggle.setAttribute("aria-expanded", false);
    }
});

// Opcional: Cierra el menú al hacer clic en un enlace (para mejor usabilidad)
const navLinks = document.querySelectorAll(".nav-list a");

navLinks.forEach(link => {
    link.addEventListener("click", () => {
        // Cierra el menú si se hace clic en un enlace
        nav.setAttribute("data-visible", false);
        navToggle.setAttribute("aria-expanded", false);
    });
});