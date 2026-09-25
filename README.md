# API Maestro-Detalle con Catálogo y Control de Estado

API en Node.js + Express + SQL Server que recibe un JSON maestro-detalle (estudiante + misiones) en un solo POST, y un tablero web que muestra el avance de cada estudiante.

**En línea:** https://ejercicio-api-seven.vercel.app (tablero) · https://ejercicio-api-seven.vercel.app/api/estudiantes (API)

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/registro` | Inserta/actualiza el estudiante y sus misiones |
| GET | `/api/misiones` | Catálogo de misiones |
| GET | `/api/estudiantes` | Estudiantes con sus misiones, estado y resumen de avance |
| GET | `/api/estudiantes/:carnet` | Un estudiante |
| GET | `/api/health` | Verifica la conexión con la BD |

### POST `/api/registro`

```json
{
  "maestro": { "carnet": "1890-20-11489", "nombre": "MERCEDES AZUCENA LÓPEZ PÉREZ", "correo": "mlopezp58@miumg.edu.gt" },
  "detalle": [
    { "misionId": 1, "estado": true },
    { "misionId": 2, "estado": false },
    { "misionId": 3, "estado": true }
  ]
}
```

Reglas:
- Si el carnet no existe, se inserta el estudiante; si ya existe, se actualizan nombre y correo.
- Cada `misionId` debe existir en `Misiones`; si no existe → **422** con `misionesInexistentes`.
- Si la misión no está en `EstudianteMisiones` se inserta; si ya está se actualiza `Estado`.
- Todo corre en una sola transacción: si algo falla, no se guarda nada.

Respuestas: `201` (estudiante nuevo), `200` (actualizado), `400` (JSON inválido), `409` (correo usado por otro carnet), `422` (misión inexistente).

## Ejecutar localmente

```bash
npm install
cp .env.example .env   # y completar DB_PASSWORD
npm start              # http://localhost:3000
```

El frontend se sirve desde `public/` en la misma URL.

## Despliegue

**Backend + frontend juntos (Render, Railway o Azure App Service):**
1. Conectar el repositorio de GitHub.
2. Build: `npm install` · Start: `npm start`.
3. Definir las variables de entorno `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_NAME`.

**Frontend en GitHub Pages (opcional):** publicar la carpeta `public/` y en `public/config.js` poner la URL del backend en `window.API_URL`.

## Estructura

```
src/
  server.js    rutas y manejo de errores
  registro.js  validación y lógica del maestro-detalle
  db.js        conexión a SQL Server
public/        tablero (HTML/CSS/JS)
```

## Autor

Anthony David Martínez León · Carnet 1890-23-23782 · amartinezl12@miumg.edu.gt
