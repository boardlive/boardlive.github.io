# 1. BoardLive no recoge estadísticas de uso

Fecha: 2026-10-30 · Estado: aceptado

## Contexto

Desde marzo de 2026, `analytics.js` enviaba cada visita a un contador propio en bilateria.org (`https://bilateria.org/app/estadistica/boardlive/track.php`), con una petición JSONP que se hacía después de cargar la página. Para no contar dos veces al mismo navegador, guardaba la hora de la última visita en `localStorage` y solo volvía a contar al cabo de 30 minutos. La dirección del contador y el identificador del sitio iban en dos etiquetas `meta` de `index.html`.

La evaluación con la rúbrica VCER de la guía «Vibe coding responsable» puntúa con 0 el punto de datos personales si el recurso lleva analítica, sea propia o ajena. Además, cada visita hacía que el navegador del alumnado o del profesorado se comunicara con un servidor que no hace falta para usar la pizarra.

## Decisión

Se retira toda la analítica: el archivo `analytics.js`, su etiqueta `<script>` y las etiquetas `meta` `analytics-endpoint` y `analytics-site-id` de `index.html`. La pizarra solo se comunica ya con los servicios que necesita para funcionar: el servidor de señalización de PeerJS y los servidores STUN/TURN que conectan a los participantes, y las bibliotecas que se cargan desde CDN.

## Alternativas descartadas

- **Mantener el contador propio.** No usaba cookies, pero seguía haciendo que cada navegador se comunicara con bilateria.org, y la rúbrica VCER puntúa con 0 cualquier analítica.

## Consecuencias

- Ya no hay cifras de uso de BoardLive.
- Los datos del contador en el alojamiento de IONOS (`/app/estadistica/boardlive/`) y en el panel central de estadísticas se archivan y se borran del servidor en una tarea aparte.
- En los navegadores que ya la visitaron queda la clave `analytics:last-visit:boardlive` de `localStorage`, que ya no se lee ni se escribe.
