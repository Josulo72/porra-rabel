# La Porra de Supervivencia

SPA en un solo archivo (`index.html`) con React + Tailwind para gestionar una porra de supervivencia de 3 partidos.

## Abrir

1. Abre `index.html` en el navegador.
2. Panel admin oculto: `Ctrl + Shift + A`.

## Funcionalidades

- Lógica muerte súbita por orden cronológico (P1 -> P2 -> P3).
- 3 partidos fijos: Real Madrid, FC Barcelona, SD Ponferradina.
- Carga de usuarios por `JSON` o `Excel` (`.xlsx/.xls`) y persistencia en `localStorage`.
- Scraping automático durante ventana de partido con fallback manual.
- Estado visual de eliminados y supervivientes en tiempo real.
- Reset de jornada desde panel admin.

## Formato de importación

Soporta dos formatos:

- Columnas explícitas: `nombre`, `p1_local`, `p1_visitante`, `p2_local`, `p2_visitante`, `p3_local`, `p3_visitante`.
- Formato tipo porra: primera columna nombre y columnas de partido con marcador tipo `0-2`.
