# La Porra de Supervivencia

SPA en un solo archivo (`index.html`) con React + Tailwind para gestionar una porra de supervivencia de 3 partidos.

## Abrir

1. Abre `index.html` en el navegador.
2. Panel admin oculto: `Ctrl + Shift + A`.

## Funcionalidades

- Lógica muerte súbita por orden cronológico (P1 -> P2 -> P3).
- 3 partidos fijos: Real Madrid, FC Barcelona, SD Ponferradina.
- Carga de usuarios por `JSON` o `Excel` (`.xlsx/.xls`).
- Scraping automático durante ventana de partido con fallback manual.
- Estado visual de eliminados y supervivientes en tiempo real.
- Reset de jornada desde panel admin.
- Sincronización compartida opcional mediante Google Apps Script (gratis).

## Activar datos compartidos gratis (Google Apps Script)

1. Crea un proyecto en `https://script.google.com`.
2. Copia el contenido de `apps-script/Code.gs`.
3. Deploy -> New deployment -> tipo `Web app`.
4. Ejecutar como: `Me`.
5. Quién tiene acceso: `Anyone`.
6. Copia la URL del Web App.
7. En `index.html`, cambia la constante `API_BASE`:
   - De: `https://script.google.com/macros/s/REEMPLAZAR_CON_TU_DEPLOY/exec`
   - A: tu URL real del Web App.
8. Sube los cambios a GitHub Pages.

Si `API_BASE` no está configurada, la app funciona en modo local (`localStorage`).

## Formato de importación

Soporta dos formatos:

- Columnas explícitas: `nombre`, `p1_local`, `p1_visitante`, `p2_local`, `p2_visitante`, `p3_local`, `p3_visitante`.
- Formato tipo porra: primera columna nombre y columnas de partido con marcador tipo `0-2`.
