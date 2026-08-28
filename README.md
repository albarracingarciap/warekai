# Warekai

Gestión de cocina profesional para un grupo de restauración con dos
establecimientos. Catálogo de materias primas, recetario con elaboraciones
anidadas y escandallos con coste exacto.

Esta primera iteración cubre la base del sistema y el módulo vertical de
catálogo y escandallos. Inventario, compras, producción, mermas, APPCC y
analítica quedan como carpetas vacías con su punto de enganche documentado.

> **Estado actual y punto de retomada:** [ESTADO.md](ESTADO.md).

---

## Arrancar desde cero

### Requisitos

| Herramienta | Versión        | Comprobar                             |
| ----------- | -------------- | ------------------------------------- |
| Node        | ≥ 20.11        | `node -v`                             |
| pnpm        | ≥ 9            | `pnpm -v` — si falta: `npm i -g pnpm` |
| Docker      | con Compose v2 | `docker compose version`              |

### Puesta en marcha

```bash
git clone <repo> warekai && cd warekai
pnpm install

cp .env.example .env
# Genera secretos distintos para acceso y refresco:
#   openssl rand -base64 48

pnpm db:up          # PostgreSQL 16 y Redis 7 en Docker
pnpm build          # compila domain y contracts (los consume la API)
pnpm db:migrate     # esquema + seguridad a nivel de fila
pnpm db:seed        # 51 materias primas, 5 elaboraciones, 8 platos

pnpm dev:api        # API en http://localhost:3000/api  ·  OpenAPI en /docs
```

El seeder imprime al terminar las cuentas de acceso. Todas comparten la
contraseña `warekai2025`, que es de desarrollo y solo de desarrollo:

| Cuenta                         | Rol      | Alcance                           |
| ------------------------------ | -------- | --------------------------------- |
| `admin@grupomediterraneo.es`   | ADMIN    | Todo el grupo                     |
| `chef@grupomediterraneo.es`    | CHEF     | Centro (y solo lectura en Puerto) |
| `partida@grupomediterraneo.es` | COCINERO | Centro, **sin ver costes**        |
| `oficina@grupomediterraneo.es` | OFICINA  | Todo el grupo, solo lectura       |

PIN de cocina `2468`, token de dispositivo `tablet-partida-caliente-demo`.

### Sin Docker

El `docker-compose.yml` es la vía soportada. Si no puedes usarlo, basta un
PostgreSQL 16 y un Redis 7 locales; apunta `DATABASE_URL`, `REDIS_HOST` y
`REDIS_PORT` a ellos. **El usuario de la aplicación no puede ser superusuario**:
los superusuarios se saltan la seguridad a nivel de fila y el aislamiento entre
clientes dejaría de existir en silencio.

Sin Redis la API arranca igual y los recálculos se ejecutan en línea, más lento
pero correcto.

### Comandos

```bash
pnpm test                 # todas las suites
pnpm test:domain          # motor de costes, con cobertura del 100 %
pnpm lint                 # ESLint en todo el monorepo
pnpm typecheck            # tsc --noEmit en todos los paquetes
pnpm db:reset             # vacía el esquema (solo desarrollo)
pnpm --filter @warekai/api test:integration   # RLS y ciclos, exige Postgres
```

---

## Estructura

```
apps/
  api/            NestJS + Drizzle + PostgreSQL
  web/            React + Vite   (pendiente, ver ESTADO.md)
packages/
  domain/         Motor de costes. TypeScript puro, sin infraestructura.
  contracts/      Esquemas Zod compartidos entre API y frontend.
  ui/             Componentes y tokens de diseño (pendiente)
```

---

## Los tres conceptos que sostienen el sistema

### Triple unidad

Cada ítem tiene tres niveles: **compra** (caja), **stock** (botella) y **uso**
(mililitro). Compra y stock son niveles de empaquetado con etiqueta libre; solo
la unidad de uso es física, y es donde entra el análisis dimensional.

Dos puentes por ítem permiten cruzar entre magnitudes: **densidad** (g/ml) y
**peso por pieza** (g/ud). Sin ellos el sistema no resuelve "media cebolla" ni
"un chorro de aceite". Cuando falta el puente necesario, el motor lo dice
nombrando el ítem, en vez de devolver un número plausible y falso.

### Doble merma

Son dos factores distintos y se aplican los dos.

**Merma de limpieza** (factor de corrección), en el ítem. Del peso bruto al
neto en el despiece. Una alcachofa rinde el 40 % de su peso de compra.

**Merma de proceso** (rendimiento), en la elaboración. Pérdida por cocción o
reducción. Un fondo reduce al 40 %.

La dirección importa. La receta declara **peso neto** —lo que llega al plato,
ya limpio— y el motor deduce lo que hay que sacar de cámara: 200 g de alcachofa
limpia son 500 g de compra. Es la convención del escandallo profesional y evita
que el cocinero haga la cuenta mentalmente.

La merma de proceso vive en la elaboración, no en la línea que la consume. Un
solo lugar de verdad: quien usa el fondo hereda un coste por litro que ya
incorpora la reducción.

### Elaboraciones anidadas

Grafo dirigido acíclico sin límite de profundidad. El seeder trae una cadena de
cuatro niveles:

```
Alcachofas confitadas → Crema de alcachofa → Fondo oscuro → Sofrito base
```

Los costes se propagan en orden topológico, así que cada nodo se calcula una
sola vez con sus insumos ya resueltos. Los ciclos se detectan y se bloquean en
tres sitios: el motor (que devuelve la ruta completa, `salsa → fondo → salsa`),
la capa de servicio y un disparador en la base de datos.

---

## Decisiones técnicas

### Aritmética monetaria

`Money` guarda **céntimos en un `Decimal`**, nunca en un `number`, y admite
céntimos fraccionarios a propósito. Un gramo de perejil cuesta una milésima de
céntimo; redondear cada línea de un escandallo de tres niveles se nota en el
margen a fin de mes. Se arrastra precisión completa y se redondea **una sola
vez**, al presentar o al persistir.

Consecuencia en el transporte: los importes viajan como **entero de céntimos**
(cabe exacto en el `number` de JSON) y los factores decimales —densidades,
mermas, IVA— viajan como **cadena** y se reconstruyen con `Decimal`. Un `0.1`
que pasa por un `number` deja de ser `0.1`.

`decimal.js` se clona con configuración propia (precisión 34, `ROUND_HALF_UP`)
en lugar de configurar el global, para no alterar el comportamiento de la
librería en el resto de la aplicación.

### Food cost sobre PVP sin IVA

`foodCost% = coste / PVP_neto`. El IVA no es ingreso del restaurante; meterlo en
el denominador maquilla el food cost a la baja. El motor devuelve también el PVP
con IVA para carta, y el cálculo inverso redondea **siempre hacia arriba**:
bajar el precio para cuadrar un número bonito empeora el margen, y esa decisión
la toma una persona.

### El paquete `domain` no toca infraestructura

TypeScript puro con `decimal.js` como única dependencia. Cobertura del 100 % con
umbral en `vitest.config.ts`, así que por debajo el comando falla y el
pre-commit lo bloquea. Hay pruebas que leen los propios fuentes y fallan el día
que alguien importe una base de datos «solo un momento» en este paquete.

El caso de referencia del enunciado está verificado a mano, céntimo a céntimo:
alcachofa al 40 % dentro de una salsa reducida al 40 %, dentro de un plato de
tres raciones.

### Multi-tenencia con RLS desde el primer día

`tenant_id` en toda tabla de negocio, con política que compara contra
`current_setting('app.tenant_id')`. `withTenant` abre transacción y fija la
variable con `set_config(..., true)` —local a la transacción, para que no se
filtre a la siguiente consulta que reutilice la conexión del pool.

**`FORCE ROW LEVEL SECURITY` no es opcional.** Postgres no aplica las políticas
al propietario de la tabla salvo que se le obligue, y en desarrollo la
aplicación se conecta con el mismo rol que creó el esquema. Sin `FORCE`, la
política existiría y no filtraría nada: el aislamiento parecería funcionar hasta
el día que no.

`tenant`, `allergen`, `role` y `permission` quedan fuera de RLS a propósito: son
catálogos raíz, y `tenant` tiene que poder leerse durante el login, antes de
saber cuál es el tenant.

### Autorización en la capa de servicio

`assertPermission` se invoca desde los **servicios**, no desde guards de
controlador ni desde la interfaz. Ocultar un botón no es una medida de
seguridad, y un guard se olvida en cuanto alguien añade un método o llama al
servicio desde un trabajo en cola. El guard global solo autentica y resuelve el
establecimiento activo.

`COCINERO` no tiene `cost:read`: la ficha técnica de partida muestra cantidades
y procedimiento, no márgenes.

### Acceso por PIN

Teclear un correo y una contraseña larga con guantes y las manos mojadas no es
viable. El PIN exige **dos cosas**: el token del dispositivo, que se instala una
vez en la tablet, y el PIN de la persona. Cuatro dígitos por sí solos no
protegen nada; atados a un aparato concreto que está dentro de la cocina, sí.

La sesión resultante hereda el establecimiento del dispositivo, caduca en 8 h en
lugar de 15 min de token de acceso renovable, y no puede tocar precios.

### Recálculo en cola, con caída a ejecución en línea

Cambiar el precio de la harina toca la salsa, el plato y el menú. Va en cola
porque puede disparar decenas de recetas y quien corrige un albarán no tiene por
qué esperar. **Si Redis no responde, se ejecuta en el momento**: preferimos una
petición lenta a un escandallo que dice que el plato cuesta lo que costaba antes
de subir la harina. Perder el trabajo en silencio no se detecta mirando la
pantalla.

### OpenAPI generado desde los esquemas Zod

Los decoradores de Swagger obligarían a mantener una segunda definición en
paralelo a la de los contratos. En vez de eso se convierten a JSON Schema los
esquemas Zod que ya validan la entrada. Una sola fuente de verdad: la
documentación no puede quedarse obsoleta respecto a la validación porque son el
mismo objeto.

### Doble formato de publicación en los paquetes compartidos

NestJS se ejecuta en CommonJS y Vite en ESM. `domain` y `contracts` se publican
con tsup en los dos formatos. La alternativa —forzar ESM en Nest— cuesta los
metadatos de decorador de los que depende su inyección de dependencias.

Por lo mismo, `@typescript-eslint/consistent-type-imports` está desactivada solo
en `apps/api`: TypeScript emite `design:paramtypes` únicamente para imports de
valor, así que convertir `import { CostingService }` en `import type` deja el
metadato vacío y el contenedor inyecta `undefined` en tiempo de ejecución, sin
ningún aviso al compilar.

### Drizzle en lugar de Prisma

Drizzle genera SQL plano, así que `SET LOCAL app.tenant_id` y las políticas de
RLS se escriben de forma directa y auditable. Con Prisma habría que envolver
cada consulta en `$transaction` con `$executeRaw`, y olvidar el envoltorio una
sola vez es una fuga entre clientes.
