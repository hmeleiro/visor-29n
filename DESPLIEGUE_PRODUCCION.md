# Despliegue en producción

Esta guía describe el despliegue del visor 29N en un único servidor Linux con Docker Compose y un proxy inverso HTTPS. La aplicación se distribuye como un solo contenedor: Fastify sirve la API, el frontend compilado y el canal de actualización en tiempo real mediante Server-Sent Events (SSE).

La aplicación es de solo lectura. No necesita migraciones ni crear vistas en MySQL; consulta las tablas `resultados_totales` y `candidaturas`.

## 1. Arquitectura de producción

```text
Navegador
   │ HTTPS :443
   ▼
Proxy inverso (Nginx o balanceador corporativo)
   │ HTTP 127.0.0.1:3000
   ▼
Contenedor visor-escrutinio
   ├── frontend React/ECharts
   ├── API Fastify
   ├── SSE /api/events
   └── histórico 23J preprocesado
             │ TCP 3306
             ▼
          MySQL
```

Se recomienda una sola réplica. Cada réplica mantiene su propio sondeo de la base de datos, por lo que escalar horizontalmente multiplica las consultas a MySQL. Para el runtime, una instancia con 1 vCPU, 1 GB de RAM y 5 GB libres es un punto de partida suficiente; si la imagen se construye en ese mismo servidor, reserva preferiblemente 2 GB de RAM o memoria de intercambio. Conviene ajustarlo después de observar el consumo real.

## 2. Requisitos previos

- Docker Engine y el complemento Docker Compose v2 (`docker compose version`).
- Acceso desde el servidor al host y puerto de MySQL.
- Un nombre DNS para el visor.
- Un certificado TLS, ya sea en Nginx, en el balanceador corporativo o mediante el sistema de certificados de la organización.
- El código completo del proyecto, incluido `votos_escrutinio_provincias_acumulado_23J.csv`.
- Un usuario MySQL dedicado de solo lectura.

La imagen usa Node.js 22, pero no es necesario instalar Node.js en el servidor si todo se construye con Docker.

## 3. Preparar el usuario de base de datos

La aplicación solo necesita `SELECT` en dos tablas. Sustituye los valores en mayúsculas y limita el host al servidor o a la red desde la que saldrán los contenedores:

```sql
CREATE USER 'visor_29n'@'HOST_O_PATRON_DE_RED'
  IDENTIFIED BY 'CLAVE_LARGA_Y_UNICA';

GRANT SELECT ON NOMBRE_BASE.resultados_totales
  TO 'visor_29n'@'HOST_O_PATRON_DE_RED';

GRANT SELECT ON NOMBRE_BASE.candidaturas
  TO 'visor_29n'@'HOST_O_PATRON_DE_RED';
```

No expongas MySQL a Internet: permite el puerto únicamente desde el servidor del visor y usa una red privada de confianza. El cliente actual no expone parámetros TLS de MySQL mediante variables de entorno; si la política de la organización exige cifrado hasta la base de datos, habrá que añadir esa configuración al pool de conexión antes del despliegue.

Antes del despliegue, comprueba que el usuario puede leer ambas tablas y que los envíos completos contienen 52 filas provinciales (`ccaa_prov = 'PR'`) y una fila nacional (`ccaa_prov = 'TO'`). El visor considera completo un envío cuando encuentra exactamente 53 filas relevantes.

## 4. Configurar el entorno

En el directorio del proyecto, crea el fichero real a partir de la plantilla:

```bash
cp .env.example .env
```

Configura al menos:

```dotenv
DB_HOST=mysql.interno.example
DB_PORT=3306
DB_NAME=escrutinio
DB_USER=visor_29n
DB_PASSWORD=una-clave-de-base-de-datos

DASHBOARD_USER=operador
DASHBOARD_PASSWORD=una-clave-larga-y-unica

PORT=3000
POLL_INTERVAL_MS=2000
EXPECTED_TERRITORY_ROWS=53
```

Usa los nombres `DB_*` en despliegues nuevos. Se mantienen `HOSTNAME`, `DBPORT`, `DBNAME`, `DBUSER` y `DBPASS` únicamente por compatibilidad con el fichero anterior.

| Variable | Uso | Valor normal |
| --- | --- | --- |
| `DB_HOST` | Host MySQL | obligatorio |
| `DB_PORT` | Puerto MySQL | `3306` |
| `DB_NAME` | Base de datos | obligatorio |
| `DB_USER` | Usuario MySQL | obligatorio |
| `DB_PASSWORD` | Contraseña MySQL | obligatorio |
| `DASHBOARD_USER` | Usuario de HTTP Basic | obligatorio |
| `DASHBOARD_PASSWORD` | Contraseña de HTTP Basic | obligatorio |
| `PORT` | Puerto interno del servicio | `3000` |
| `POLL_INTERVAL_MS` | Intervalo de consulta de nuevos envíos | `2000` |
| `EXPECTED_TERRITORY_ROWS` | Filas `PR` + `TO` exigidas para publicar un envío | `53` |
| `LOG_LEVEL` | Nivel de log de Fastify | `info` |

`APP_HOST`, `STATIC_DIR` y `HISTORY_DIR` existen como ajustes avanzados, pero no deben cambiarse en el contenedor estándar.

El fichero `.env` está excluido de Git y del contexto de construcción de Docker. No lo copies a la imagen ni lo envíes por correo o mensajería. El `docker-compose.yml` actual lo monta en `/app/.env` en modo de solo lectura. En Linux, asegúrate de que el usuario no privilegiado `app` del contenedor puede leer ese bind mount; si la política exige que el fichero tenga modo `600`, utiliza un secreto del orquestador o inyecta esas variables con `env_file` en la configuración local de producción en vez de montar el fichero.

No uses las credenciales de ejemplo. HTTP Basic solo es aceptable sobre HTTPS.

## 5. Endurecer la exposición de red

El Compose incluido publica inicialmente `3000:3000`, es decir, en todas las interfaces. Si el proxy inverso está en el mismo servidor, cambia esa línea en la copia de producción para que el servicio solo escuche desde el host local:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

Abre al exterior únicamente `443/tcp` y, si procede, `80/tcp` para la redirección a HTTPS. Restringe el acceso administrativo por SSH y la salida a MySQL mediante las reglas de red correspondientes. La publicación de puertos de Docker puede interactuar con las reglas del cortafuegos del host; el bind explícito a `127.0.0.1` evita depender solo del cortafuegos.

## 6. Validar y construir la versión

En CI o en una máquina de construcción con Node.js 22, ejecuta:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

El paso `npm run build` también transforma el CSV del 23J en los ficheros compactos de `generated/history`. El `Dockerfile` repite la instalación reproducible y la compilación dentro de una fase de construcción; la imagen final contiene solo las dependencias de producción y se ejecuta con el usuario no privilegiado `app`.

En el servidor, valida Compose y construye la imagen:

```bash
docker compose config --quiet
docker compose build --pull visor-escrutinio
```

La construcción necesita acceso al registro de imágenes de Docker y al registro de npm. No necesita conexión a MySQL hasta que arranca el contenedor.

## 7. Arrancar el servicio

```bash
docker compose up -d --remove-orphans visor-escrutinio
docker compose ps
docker compose logs --tail=100 visor-escrutinio
```

El servicio usa `restart: unless-stopped`, por lo que vuelve a arrancar después de un reinicio del servidor. El healthcheck consulta cada 15 segundos `/healthz`; esta ruta comprueba también la conexión a MySQL.

Verifica primero desde el propio servidor:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
```

La respuesta correcta es:

```json
{"status":"ok"}
```

Si devuelve HTTP 503, el proceso está levantado pero no puede conectar con MySQL. Revisa la red, el nombre DNS, el puerto, las credenciales y los permisos del usuario.

## 8. Configurar Nginx y TLS

Si no existe ya un proxy corporativo, esta configuración de Nginx sirve como base. Sustituye el dominio y las rutas de los certificados:

```nginx
server {
    listen 80;
    server_name escrutinio.example.es;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name escrutinio.example.es;

    ssl_certificate     /etc/ssl/certs/escrutinio.crt;
    ssl_certificate_key /etc/ssl/private/escrutinio.key;

    location = /api/events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
    }
}
```

`proxy_buffering off` y un timeout largo son importantes para que el canal SSE permanezca abierto y cada envío llegue al navegador sin quedar retenido por el proxy. Si se usa un balanceador corporativo, aplica allí los equivalentes: sin buffering para `/api/events`, timeout de al menos varios minutos y paso de la cabecera `Authorization`.

Valida y recarga Nginx según el sistema operativo. Después comprueba:

```bash
curl --fail --silent --show-error https://escrutinio.example.es/healthz
curl --fail --silent --show-error --user operador https://escrutinio.example.es/api/meta
```

En la segunda orden, `curl` solicitará la contraseña sin tener que dejarla escrita en el historial de la terminal.

## 9. Verificación funcional posterior

Realiza estas comprobaciones desde un navegador conectado por la misma ruta que usarán los usuarios:

1. La URL redirige a HTTPS y solicita las credenciales del visor.
2. La ficha de España y una provincia muestran el último envío completo.
3. La comparación con el 23J carga y la leyenda permite ocultar y mostrar partidos.
4. El selector de territorios y los modos de voto/escaños funcionan.
5. La sección del último escaño muestra el envío seleccionado y su deslizador permite retroceder.
6. Al entrar un nuevo envío completo, la pantalla se actualiza sin recargar la página.
7. `docker compose ps` muestra el contenedor como `healthy` y no aparecen errores repetidos en los logs.

La API no publica un envío parcial. Mientras haya menos o más de las 53 filas relevantes esperadas, los usuarios continúan viendo el último envío completo. Para la batalla del último escaño, un envío debe contener las 52 provincias distintas.

## 10. Operación y monitorización

Comandos habituales:

```bash
docker compose ps
docker compose logs --tail=200 visor-escrutinio
docker compose logs --since=15m -f visor-escrutinio
docker stats --no-stream
```

Monitoriza externamente `https://DOMINIO/healthz`. Un HTTP 200 confirma que la aplicación responde y que MySQL acepta conexiones; un HTTP 503 debe generar alerta. La ruta no requiere autenticación y solo devuelve `ok` o `error`, por lo que no expone datos electorales ni detalles de la base.

Para evitar que los logs ocupen el disco, configura rotación en el daemon de Docker o añade a la definición del servicio:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"
```

Durante la jornada electoral conviene vigilar además:

- latencia y disponibilidad de MySQL;
- número de conexiones del usuario del visor —el pool usa como máximo cinco por instancia—;
- errores `Error comprobando nuevos envíos`;
- espacio libre en disco y crecimiento de logs;
- continuidad de `/api/events` a través del proxy.

## 11. Publicar una actualización

La instalación actual usa estos valores:

- repositorio: `https://github.com/hmeleiro/visor-29n.git`;
- rama de producción: `main`;
- servidor: `deploy@217.154.183.47`;
- directorio: `/opt/visor-29n`;
- URL pública: `https://29n.spainelectoralproject.com`.

Una actualización normal no requiere modificar `.env`, MySQL, Nginx, el certificado ni Cloudflare. El fichero `.env` del servidor no está versionado y se conserva durante `git pull` y durante la reconstrucción del contenedor.

### 11.1. Validar, confirmar y subir desde el equipo local

Ejecuta las comprobaciones con Node.js 22:

```powershell
npm run typecheck
npm test
npm run build
```

Revisa qué se va a publicar, añade los cambios y crea un commit descriptivo:

```powershell
git status --short
git add -A
git commit -m "TIPO: descripción breve del cambio"
git push origin main
```

Sustituye `TIPO` por `feat`, `fix`, `perf` o `docs` según corresponda. Para una actualización exclusivamente documental, por ejemplo:

```powershell
git commit -m "docs: documenta la actualización en producción"
```

Comprueba el identificador de la versión que acabas de subir:

```powershell
git rev-parse --short HEAD
```

No subas `.env`; debe seguir ignorado y nunca formar parte del commit.

### 11.2. Descargar la versión en el servidor

Conéctate y entra en el directorio del proyecto:

```bash
ssh deploy@217.154.183.47
cd /opt/visor-29n
```

Antes del `pull`, verifica que no haya cambios locales inesperados y anota el commit actual para poder volver a él:

```bash
git status --short
git rev-parse --short HEAD
```

Si `git status --short` muestra cambios, no continúes hasta identificar su origen. El `.env` no debería aparecer porque está ignorado. Con el árbol limpio:

```bash
git fetch --prune origin
git pull --ff-only origin main
git rev-parse --short HEAD
```

El identificador final debe coincidir con el obtenido en el equipo local.

### 11.3. Reconstruir y sustituir el contenedor

Esta versión cambia el frontend, el servidor y `package-lock.json`, por lo que hay que reconstruir la imagen; un simple `docker compose restart` seguiría ejecutando el código anterior.

Primero valida la configuración y construye la imagen mientras el contenedor actual sigue atendiendo peticiones:

```bash
docker compose config --quiet
docker compose build --pull visor-escrutinio
```

Si el build termina correctamente, sustituye solo el servicio del visor:

```bash
docker compose up -d --no-deps --force-recreate visor-escrutinio
docker compose ps
```

La sustitución de la única réplica puede producir una interrupción de pocos segundos. No es necesario reiniciar Nginx ni MySQL.

### 11.4. Verificar la actualización

Comprueba primero el contenedor y la conexión a MySQL desde el propio servidor:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
docker compose ps
docker compose logs --tail=100 visor-escrutinio
```

La respuesta de salud debe ser `{"status":"ok"}` y el servicio debe pasar a `healthy`. Después comprueba la ruta completa a través de Nginx y Cloudflare:

```bash
curl --fail --silent --show-error https://29n.spainelectoralproject.com/healthz
```

Finalmente, abre el dashboard en una ventana nueva o haz una recarga forzada y verifica:

1. Se cargan España y las dos provincias con la batalla más ajustada.
2. Las fichas de evolución usan Inter, líneas escalonadas y tooltips de voto o escaños.
3. Las filas de la batalla tienen una altura constante.
4. Las teclas izquierda y derecha cambian de envío sin enfocar el gráfico.
5. `Reproducir` comienza en el primer envío, avanza hasta el último y permite pausar.
6. El deslizador sigue respondiendo con fluidez y `Volver al directo` recupera el último envío.
7. La conexión SSE continúa activa y un envío nuevo aparece sin recargar la página.

Los recursos del frontend llevan nombres con hash, por lo que no es necesario purgar normalmente la caché de Cloudflare. Si una pestaña abierta conserva la interfaz anterior, haz una recarga forzada antes de purgar cachés.

### 11.5. Rollback

La aplicación es de solo lectura y no ejecuta migraciones, por lo que se puede volver al commit anterior sin revertir la base de datos. Usa el identificador que anotaste antes del `git pull`:

```bash
cd /opt/visor-29n
git switch --detach COMMIT_ANTERIOR
docker compose build visor-escrutinio
docker compose up -d --no-deps --force-recreate visor-escrutinio
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
docker compose logs --tail=100 visor-escrutinio
```

Cuando quieras volver a desplegar la rama principal:

```bash
git switch main
git pull --ff-only origin main
docker compose build visor-escrutinio
docker compose up -d --no-deps --force-recreate visor-escrutinio
```

No ejecutes `docker compose down -v`: el proyecto no necesita borrar volúmenes y esa práctica puede eliminar datos de otros servicios si la composición se amplía en el futuro.

## 12. Problemas frecuentes

| Síntoma | Comprobación | Acción |
| --- | --- | --- |
| El contenedor reinicia continuamente | `docker compose logs visor-escrutinio` | Revisa variables obligatorias y que `/app/.env` sea legible por `app`. |
| `/healthz` devuelve 503 | Conectividad y credenciales MySQL | Permite la red del contenedor, corrige `DB_*` o los permisos. |
| El navegador devuelve 401 | `DASHBOARD_USER` y `DASHBOARD_PASSWORD` | Reintroduce credenciales; confirma que el proxy pasa `Authorization`. |
| No aparece el último envío | Cuenta filas `PR` y `TO` por `n_envio` | El envío debe tener exactamente 53 filas relevantes. Revisa duplicados o carga incompleta. |
| La batalla no ofrece el envío esperado | Cuenta provincias distintas del envío | Deben existir 52 `codigo_provincia` distintos con `ccaa_prov = 'PR'`. |
| La página carga pero no se actualiza | Pestaña de red y `/api/events` | Desactiva buffering/caché en el proxy y aumenta su timeout SSE. |
| Se sigue viendo una interfaz anterior | Imagen y caché del navegador | Fuerza la recreación del contenedor y recarga el navegador; `index.html` no se cachea. |
| Faltan nombres o colores de partidos | Tabla `candidaturas` | Completa `recode` y los campos de color para cada `codigo_candidatura`. |
| El histórico 23J no carga | Log de construcción | Confirma que el CSV estaba presente al construir la imagen y repite el build. |

## 13. Lista de comprobación de salida

- [ ] La versión ha superado `typecheck`, tests y build.
- [ ] `.env` no está en Git ni en la imagen y contiene credenciales distintas de las de ejemplo.
- [ ] El usuario MySQL solo tiene `SELECT` en las dos tablas necesarias.
- [ ] MySQL solo admite tráfico desde la red del visor.
- [ ] El puerto 3000 está vinculado a `127.0.0.1` o restringido por una red privada.
- [ ] El acceso público usa HTTPS y el certificado es válido.
- [ ] El proxy no almacena en buffer `/api/events` y conserva `Authorization`.
- [ ] `/healthz` responde 200 desde dentro y desde fuera del servidor.
- [ ] El contenedor figura como `healthy` y tiene política de reinicio.
- [ ] Se ha verificado un envío real, el histórico 23J y el deslizador del último escaño.
- [ ] Existe rotación de logs, monitorización y un procedimiento de rollback probado.

