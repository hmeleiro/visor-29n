# Visor de evolución del escrutinio 29N

Dashboard interno para seguir España y las 52 provincias, comparar la evolución del 29N con el 23J y actualizar la pantalla automáticamente cuando aparece un envío completo en MySQL.

Para instalarlo en un servidor, protegerlo con HTTPS y operarlo durante la jornada electoral, consulta [Despliegue en producción](DESPLIEGUE_PRODUCCION.md).

## Qué incluye

- Evolución completa del 29N con líneas continuas y comparación 23J discontinua.
- Modos de voto porcentual y escaños absolutos.
- Selector de hasta seis territorios, con España como selección inicial.
- Agrupación de candidaturas mediante `candidaturas.recode` y colores oficiales de esa tabla.
- Equivalencia histórica explícita `Sumar (23J) → FA (29N)`.
- Sección provincial de batalla por el último escaño: hasta tres aspirantes dentro de cuatro puntos sobre el censo, calculados con los cocientes D’Hondt del envío más reciente.
- Actualización mediante Server-Sent Events; el servidor consulta nuevos envíos una sola vez para todos los navegadores.
- Autenticación HTTP Basic y una única imagen Docker para frontend y API.

No se necesita crear ninguna vista ni modificar el esquema de la base de datos.

## Despliegue con Docker

Requisitos: Docker reciente y conectividad desde el contenedor al servidor MySQL.

El `.env` actual ya contiene `HOSTNAME`, `DBPORT`, `DBNAME`, `DBUSER` y `DBPASS`. Añade dos valores antes de arrancar:

```dotenv
DASHBOARD_USER=operador
DASHBOARD_PASSWORD=una-clave-larga-y-unica
```

Después ejecuta:

```powershell
docker compose up -d --build
```

Compose monta `.env` en `/app/.env` en modo solo lectura; el fichero no se copia a la imagen. El visor queda disponible en `http://localhost:3000`. En un servidor compartido debe publicarse detrás de un proxy HTTPS; HTTP Basic no debe circular por una red abierta sin TLS.

El `healthcheck` comprueba `/healthz`, incluida la conexión a MySQL. Para revisar el estado:

```powershell
docker compose ps
docker compose logs -f visor-escrutinio
```

### Usuario MySQL recomendado

La aplicación solo ejecuta consultas `SELECT`. Es recomendable usar un usuario dedicado con permisos mínimos:

```sql
CREATE USER 'visor_29n'@'RANGO_O_HOST_DEL_CONTENEDOR'
  IDENTIFIED BY 'CLAVE_UNICA';
GRANT SELECT ON NOMBRE_BASE.resultados_totales
  TO 'visor_29n'@'RANGO_O_HOST_DEL_CONTENEDOR';
GRANT SELECT ON NOMBRE_BASE.candidaturas
  TO 'visor_29n'@'RANGO_O_HOST_DEL_CONTENEDOR';
```

## Desarrollo y validación

Se requiere Node.js 22 o posterior.

```powershell
npm install
npm run dev
```

El frontend de desarrollo se abre en `http://localhost:5173` y reenvía `/api` al backend de `http://localhost:3000`.

Comprobaciones disponibles:

```powershell
npm run typecheck
npm run test
npm run build
npm audit --omit=dev
```

`npm run build:data` transforma el CSV del 23J en 53 ficheros compactos dentro de `generated/history`. Esa carpeta y `dist` se regeneran y no deben editarse manualmente.

## Variables de entorno

| Variable | Descripción | Predeterminado |
| --- | --- | --- |
| `DB_HOST` | Host MySQL; localmente acepta `HOSTNAME` como alias heredado | obligatorio |
| `DB_PORT` | Puerto MySQL; acepta `DBPORT` | `3306` |
| `DB_NAME` | Base de datos; acepta `DBNAME` | obligatorio |
| `DB_USER` | Usuario; acepta `DBUSER` | obligatorio |
| `DB_PASSWORD` | Contraseña; acepta `DBPASS` | obligatorio |
| `DASHBOARD_USER` | Usuario HTTP Basic | obligatorio |
| `DASHBOARD_PASSWORD` | Contraseña HTTP Basic | obligatorio |
| `POLL_INTERVAL_MS` | Frecuencia con la que el servidor busca un envío nuevo | `2000` |
| `EXPECTED_TERRITORY_ROWS` | Filas `PR` + `TO` necesarias para publicar un envío | `53` |
| `PORT` | Puerto del servicio | `3000` |

La consulta de actualización solo publica envíos con las 52 provincias y el total nacional presentes. Mientras llega un envío parcial, los navegadores continúan mostrando el último envío completo.

