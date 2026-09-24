# Nocturna Pizza

Primera versión de la web de Nocturna Pizza, una landing estática responsive con tres páginas:

- `index.html`: portada, pizzas destacadas, promociones, galería, opiniones y cómo pedir.
- `menu.html`: catálogo de muestra con filtros y pedido directo por WhatsApp.
- `contacto.html`: datos de contacto, horarios de ejemplo, mapa de ubicación, formulario para abrir WhatsApp y preguntas frecuentes.

## Ver el sitio localmente

Desde esta carpeta se puede iniciar un servidor simple con Python:

```bash
python -m http.server 4173
```

Luego abrir `http://localhost:4173` en el navegador.

## Personalizar

- El número de WhatsApp centralizado está en `script.js`, dentro de `WHATSAPP_NUMBER`.
- Los botones HTML usan el enlace confirmado de WhatsApp: `https://wa.me/5491128493108` (celular, `+54 9 11 2849-3108`).
- Los productos de muestra están en `menu.html` y en la sección de pizzas destacadas de `index.html`.
- Los textos, horarios, dirección y precios se pueden cambiar directamente en el HTML.
- `styles.css` contiene la paleta, tipografías y responsive.
- `favicon.svg` es el ícono provisional de la marca.

Las fotos actuales son imágenes de muestra servidas por Unsplash y se pueden reemplazar por imágenes propias cuando estén disponibles.
