# San Andreas Roleplay - Landing Page

![Astro](https://img.shields.io/badge/Astro-FF5D01?style=flat-square&logo=astro&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

Rediseño de la web principal para el servidor de **San Andreas RolePlay**. El enfoque fue limpiar la interfaz, arreglar los bugs de los contenedores y darle una atmósfera más "chill" acorde al servidor.

## 🛠 Cambios realizados

- **Rediseño de UI:** Se cambió el estilo plano por uno de profundidad con *Glassmorphism* y luces ambientales naranja.
- **Fix de maquetación:** Se eliminaron los bloques negros laterales. Ahora las secciones usan contenedores fluidos que aprovechan todo el ancho de pantalla.
- **Jugadores en vivo:** El contador conecta vía `fetch` a la IP `play.sarp.es:7777` para mostrar el número real de ciudadanos online y detectar eventos (Doble EXP).
- **Galería visual:** Se añadió una sección de características con imágenes reales del servidor (Casino, Downtown, etc.) usando efectos de zoom y degradados.

## 📂 Estructura

```
landing/
├── src/
│   ├── components/     # Componentes modulares (Navbar, Hero, Stats, Features...)
│   ├── layouts/        # Template base con iluminación y tipografía
│   └── pages/          # Página principal y API de jugadores
└── public/images/      # Assets, logos y capturas del juego
```

## 🚀 Instalación y uso

```bash
# Instalar dependencias
npm install

# Correr en local
npm run dev

# Generar build para producción
npm run build
```

## ⚙️ Notas técnicas

- **IP del servidor:** se configura en el componente `Stats.astro`.
- **Responsive:** diseñado con Tailwind para que no se rompa en móviles ni monitores ultra-wide.
- **Rendimiento:** optimizado con Astro para una carga instantánea.

---

> **Fork de** [San-Andreas-Roleplay-ES/landing](https://github.com/San-Andreas-Roleplay-ES/landing)

**SARP.es** - *Escribe tu propia historia.*
