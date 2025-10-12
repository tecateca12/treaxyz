const nav = document.querySelector("#primary-navigation");
const navToggle = document.querySelector(".menu-toggle");
const header = document.querySelector(".main-header"); // Seleccionamos el header

navToggle.addEventListener("click", () => {
    const visibility = nav.getAttribute("data-visible");

    if (visibility === "false") {
        // Abre el menú
        nav.setAttribute("data-visible", true);
        navToggle.setAttribute("aria-expanded", true);
        header.classList.add("menu-open"); // AÑADIDO: Agrega la clase al header
    } else {
        // Cierra el menú
        nav.setAttribute("data-visible", false);
        navToggle.setAttribute("aria-expanded", false);
        header.classList.remove("menu-open"); // AÑADIDO: Quita la clase del header
    }
});

// Cierra el menú al hacer clic en un enlace
const navLinks = document.querySelectorAll(".nav-list a");

navLinks.forEach(link => {
    link.addEventListener("click", () => {
        nav.setAttribute("data-visible", false);
        navToggle.setAttribute("aria-expanded", false);
        header.classList.remove("menu-open"); // AÑADIDO: Cierra la clase
    });
});