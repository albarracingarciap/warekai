# Estado del proyecto y punto de retomada

Última actualización: **28 de agosto de 2026**
Rama de trabajo: **`feat/andamiaje-y-motor-de-costes`** (local, sin `push`)

```bash
git checkout feat/andamiaje-y-motor-de-costes
```

`main` sigue con el commit inicial vacío. Nada se ha subido a `origin`.

---

## Resumen en una línea

Hechos los apartados **A (andamiaje)**, **B (motor de costes)**, **C (esquema de
datos)** y **D (API)** del encargo. Pendiente el apartado **E (frontend)** y el
paquete `ui`.

---

## Qué está hecho y verificado

| Parte                                             | Estado                       | Cómo se comprobó                                                                         |
| ------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| Monorepo pnpm, Turborepo, ESLint, Prettier, husky | ✅                           | `pnpm install`, hook de pre-commit ejecutándose en cada commit                           |
| Docker Compose (PostgreSQL 16 + Redis 7)          | ⚠️ escrito, **sin arrancar** | No hay Docker en esta máquina                                                            |
| `packages/domain` — motor de costes               | ✅                           | **186 pruebas, cobertura 100 %** en statements, branches, functions y lines              |
| `packages/contracts` — esquemas Zod               | ✅                           | 14 pruebas                                                                               |
| Esquema Drizzle + migraciones + RLS               | ⚠️ escrito, **sin ejecutar** | Typecheck y generación de migraciones sí; `db:migrate` no                                |
| Seeder (51 MP, 5 elaboraciones, 8 platos)         | ⚠️ escrito, **sin ejecutar** | Requiere base de datos                                                                   |
| API NestJS completa                               | ⚠️ compila, **sin arrancar** | `tsc --noEmit` limpio, `nest build` correcto, 10 pruebas unitarias verdes, ESLint limpio |
| `apps/web` — frontend                             | ❌ no empezado               | —                                                                                        |
| `packages/ui` — tokens y componentes              | ❌ no empezado               | —                                                                                        |

### El límite honesto

**En esta máquina no hay Docker ni PostgreSQL** (`docker`, `psql` y `pg_ctl` no
existen; sí hay WSL con Ubuntu 22.04 sin Postgres instalado). Todo lo que toca
base de datos está escrito, tipado y compilado, pero **nunca se ha ejecutado
contra un motor real**. Concretamente, sin verificar:

- Que las migraciones `0000_init.sql` y `0001_rls_and_integrity.sql` aplican.
- Que las políticas de RLS aíslan de verdad (hay test escrito:
  `apps/api/src/db/rls.integration.test.ts`).
- Que el disparador de ciclos de `recipe_line` rechaza lo que debe.
- Que el seeder corre entero y calcula los escandallos sin errores.
- Que la API responde.

**Lo primero al retomar** debería ser levantar Docker y correr la secuencia
completa. Es donde más probable es que aparezcan fallos.

---

## Primer paso al retomar

```bash
git checkout feat/andamiaje-y-motor-de-costes
pnpm install
pnpm build

pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm --filter @warekai/api test:integration   # RLS + ciclos
pnpm dev:api                                   # http://localhost:3000/docs
```

Si algo falla ahí, se arregla antes de tocar el frontend.

### Comprobación manual que cierra el círculo

El escandallo de referencia está verificado a mano en
`packages/domain/src/costing.test.ts`. La misma cuenta debe salir por la API:

```bash
# 1. Login
curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"chef@grupomediterraneo.es","password":"warekai2025"}'

# 2. Listar recetas y coger el id de "Alcachofas confitadas con crema de su fondo"
curl -s localhost:3000/api/recipes -H "Authorization: Bearer $TOKEN"

# 3. Escandallo explotado: cuatro niveles de profundidad
curl -s localhost:3000/api/recipes/$ID/costing -H "Authorization: Bearer $TOKEN"
```

En la respuesta, la suma de las líneas con `depth: 0` tiene que ser exactamente
`totalCostCents`, y la suma de las líneas con `isPreparation: false` (las hojas,
a cualquier profundidad) tiene que dar lo mismo. Si esas dos sumas no coinciden,
la explosión está perdiendo o duplicando coste.

---

## Lo que falta: apartado E (frontend)

Nada de esto está empezado. El plan aprobado está en
[docs/plan-iteracion-1.md](docs/plan-iteracion-1.md) y el encargo original en
[docs/encargo.md](docs/encargo.md).

### 1. `packages/ui` — sistema de diseño

Tokens propios en `packages/ui/src/tokens`, consumidos por Tailwind vía CSS
custom properties. Tres contextos reales, no un diseño estrechado:

- **Escritorio** (oficina): tablas densas, ~25 filas sin scroll, edición en
  celda, atajos de teclado.
- **Tableta** (partida): escala tipográfica paralela con paso ~1,4×, legible a
  un metro; áreas táctiles de 64 px; confirmación en dos tiempos para acciones
  destructivas, porque un guante roza la pantalla sin querer.
- **Móvil** (muelle y cámara): flujos de una sola mano.

Contraste mínimo 7:1 en texto principal, por encima del AA exigido: la cocina
tiene zonas mal iluminadas y zonas con reflejo.

Sin librerías de gráficas. El cuadro de mando son tres tarjetas numéricas y una
lista ordenada.

### 2. `apps/web` — Vite + React 18 + PWA

Estructura prevista:

```
src/
  data/          ← PUNTO DE EXTENSIÓN OFFLINE
    ports.ts     interfaces CatalogPort, RecipePort, CostingPort
    http/        implementación actual: fetch + tipos de @warekai/contracts
    queries/     hooks de TanStack Query construidos sobre los ports
    OFFLINE.md   documenta el contrato de la cola en IndexedDB
  features/{auth,catalog,recipes,dashboard}/
  app/           router, providers, layouts
  styles/
```

Los componentes **nunca** llaman a `fetch` ni conocen las URLs. La cola offline
se insertará como decorador sobre los ports —escribe en IndexedDB, encola la
mutación, resuelve optimista— sin tocar un solo componente.

Pantallas del encargo:

1. Autenticación y selector de establecimiento (cabecera
   `X-Warekai-Establishment`).
2. Listado y ficha de ítems, con gestión de unidades y conversiones.
3. Editor de escandallo con **coste en vivo**: usa `POST /api/recipes/costing/draft`,
   que ya está implementado y devuelve el escandallo de líneas sin guardar. La
   regla de cálculo sigue en `packages/domain`; el navegador manda lo que hay en
   pantalla y recibe el número.
4. Ficha técnica en lectura, optimizada para tableta.
5. Cuadro de mando: `GET /api/dashboard` ya devuelve número de platos, food cost
   medio, lista de platos por encima del objetivo y cuántas recetas tienen el
   coste obsoleto.

### 3. Cerrar

- Actualizar la tabla de estado de este fichero.
- Commit `docs:` final si hiciera falta.

---

## Decisiones de dominio que confirmaste

No hay que volver a preguntarlas.

1. **`recipe_line.quantity` es peso NETO.** El cocinero escribe "200 g de
   alcachofa limpia" y el motor divide por el factor de corrección para saber
   que hay que sacar 500 g de cámara.
2. **La merma de proceso vive en la elaboración**, no en la línea que la
   consume. Un solo lugar de verdad.
3. **El food cost se calcula sobre PVP sin IVA.** El ítem guarda su `vatRate` y
   el motor devuelve también el precio con IVA para carta.
4. **Stack:** Drizzle (por lo directo del RLS) y TanStack Router (rutas
   tipadas).

---

## Mudarse a otro ordenador

Basta con clonar el repositorio: lleva todo lo necesario, incluidos el encargo
original y el plan aprobado en [`docs/`](docs/). Lo único que **no** viaja, y hay
que rehacer en la máquina nueva:

```bash
cp .env.example .env     # está en .gitignore; genera secretos nuevos
pnpm install             # instala husky y compila los hooks
pnpm build               # domain y contracts se consumen desde dist/
```

No hace falta conservar el historial de la conversación de desarrollo: el porqué
de cada decisión está en los mensajes de commit (`git log`), en los comentarios
del código y en la sección «Decisiones técnicas» del README.

---

## Cosas que conviene saber antes de tocar el código

- **El `.env` local está en `.gitignore` y no viaja con el repositorio.** Hay que
  crearlo desde `.env.example` y generar secretos propios
  (`openssl rand -base64 48`).
- **El pre-commit ejecuta la suite entera de `domain` con su umbral del 100 %.**
  Tarda un par de segundos. Si un commit falla ahí, es que la cobertura bajó.
- **`consistent-type-imports` está desactivada en `apps/api`** y hay un
  comentario en `eslint.config.mjs` explicando por qué. No volver a activarla:
  rompe la inyección de dependencias de NestJS en tiempo de ejecución, sin aviso
  al compilar.
- **Cuidado con reescribir ficheros con PowerShell y `Get-Content -Raw`.** En
  esta máquina destroza los caracteres no ASCII. Usar el editor.
- **`packages/domain` y `packages/contracts` hay que compilarlos** (`pnpm build`)
  antes de arrancar la API: se consumen desde `dist`, no desde el fuente.

---

## Historial de commits de la rama

```
b97907a feat(api): esquema con RLS, seeder realista y API de catalogo y escandallos
1d08145 chore: publicar domain y contracts en doble formato ESM y CommonJS
1c0a332 feat(contracts): esquemas Zod compartidos entre API y frontend
c4b9a8a feat(domain): grafo aciclico, escandallo explotado, precios y alergenos
17a9c89 feat(domain): aritmetica decimal exacta, triple unidad y doble merma
083d9c9 chore: andamiaje de monorepo con pnpm, Docker y control de calidad
```
