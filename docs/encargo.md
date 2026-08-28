## PROMPT

Eres el desarrollador principal de una aplicación web de gestión de cocina profesional para un grupo de restauración con dos establecimientos. Vas a construir el andamiaje inicial del proyecto y un primer módulo vertical completo.

Antes de escribir código, presenta un plan y espera mi confirmación.

### Contexto de dominio

La aplicación gestiona el ciclo completo de una cocina: catálogo de materias primas, proveedores y compras, inventario, escandallos y recetario, producción, mermas, carta y registros sanitarios. En esta primera iteración solo implementarás la base y el módulo de catálogo y escandallos.

Hay tres conceptos de dominio que determinan la corrección de todo el sistema. Léelos con atención porque son la fuente habitual de errores:

**1. Triple unidad por ítem.** Cada ítem tiene una unidad de compra (caja de 6 botellas), una unidad de stock (botella) y una unidad de uso en receta (mililitro). Los factores de conversión se definen por ítem e incluyen densidad, para convertir entre volumen y peso, y peso por pieza, para ingredientes contados por unidades. Sin esto el sistema no puede resolver "media cebolla" ni "un chorro de aceite".

**2. Doble merma.** Se distinguen dos factores diferentes y ambos se aplican:

- _Merma de limpieza o factor de corrección_: pérdida del peso bruto al peso neto en el despiece o la limpieza. Una alcachofa rinde en torno al 40 % de su peso de compra.
- _Merma de proceso o rendimiento_: pérdida durante la elaboración por cocción, reducción o deshidratación. Un fondo puede reducirse un 60 %.

El coste por gramo servido resulta de aplicar sucesivamente ambos factores a lo largo de toda la cadena de elaboraciones anidadas.

**3. Elaboraciones anidadas sin límite de profundidad.** Un plato usa una salsa, que usa un fondo, que parte de una guarnición aromática. Se modela como grafo dirigido acíclico con detección y bloqueo de ciclos. El recálculo de costes se propaga en orden topológico.

Un único modelo de ítem con tipo asociado —materia prima, elaboración intermedia o artículo de venta— y no tres entidades separadas: una bebida es a la vez materia prima y artículo de venta.

### Stack

**Frontend**

- React 18 con TypeScript en modo estricto, sobre Vite
- Aplicación web progresiva instalable, con manifiesto y service worker
- TanStack Query para el estado de servidor
- TanStack Router o React Router para navegación
- Zustand para estado de interfaz
- React Hook Form con Zod para formularios y validación
- Tailwind CSS con sistema de diseño propio
- Vitest y Testing Library

**Backend**

- NestJS con TypeScript
- PostgreSQL con Prisma o Drizzle
- API REST documentada con OpenAPI, y tipos compartidos con el frontend
- Zod para validación de entrada

**Estructura de monorepo**

```
/apps
  /web          Frontend React
  /api          Backend NestJS
/packages
  /domain       Motor de costes: TypeScript puro, sin dependencias
  /contracts    Tipos y esquemas Zod compartidos
  /ui           Componentes de interfaz reutilizables
```

Usa pnpm workspaces.

### Alcance de esta iteración

**A. Andamiaje**

Monorepo funcional, Docker Compose con PostgreSQL, configuración de linter y formateador, husky con comprobación previa al commit, variables de entorno tipadas, y un README que explique cómo arrancar el proyecto desde cero.

**B. Paquete `domain`: motor de costes**

Es la pieza más importante de esta iteración. TypeScript puro, sin dependencias de framework ni de base de datos, exportando funciones puras y testeadas de forma exhaustiva. Debe cubrir:

- Conversión entre unidades de compra, stock y uso, incluidas densidad y peso por pieza
- Aplicación encadenada de merma de limpieza y merma de rendimiento
- Explosión recursiva de elaboraciones anidadas
- Detección de ciclos con error explícito
- Cálculo de coste total, coste por ración, food cost porcentual y margen bruto
- Cálculo inverso: PVP necesario para alcanzar un food cost objetivo
- Escalado de receta a un número arbitrario de raciones
- Propagación de alérgenos hacia arriba en el grafo

Requisitos innegociables:

- Todos los importes con aritmética decimal exacta. Usa `decimal.js` o enteros en céntimos. **Nunca coma flotante para dinero.**
- Cobertura de pruebas del 100 % en este paquete, con casos reales: alcachofa al 40 % dentro de una salsa reducida al 60 % dentro de un plato de tres raciones.
- Cero dependencias de infraestructura. Este paquete debe poder ejecutarse en Node sin base de datos.

**C. Esquema de datos**

Modela con Prisma o Drizzle, con migraciones:

- `tenant`, `establishment`, `warehouse`
- `item` con tipo, unidades y factores de conversión
- `item_family` con jerarquía
- `allergen` y `item_allergen`
- `recipe` con versionado por vigencia
- `recipe_line` con referencia a ítem, cantidad, unidad y ambos factores de merma
- `cost_snapshot`, para congelar el coste calculado en un momento dado
- `user`, `role`, `permission`
- `audit_log`

Incluye `tenant_id` en todas las tablas de negocio y activa la seguridad a nivel de fila en PostgreSQL desde el principio. Aunque hoy haya un solo cliente, introducirlo después sería muy costoso.

Añade un seeder con datos realistas en castellano: unas cuarenta materias primas de una cocina mediterránea con sus factores de corrección reales, cinco elaboraciones intermedias anidadas y ocho platos.

**D. API**

Endpoints CRUD de catálogo y recetas, cálculo de escandallo, y recálculo en cascada como trabajo en cola. Autenticación con JWT y refresco, más autenticación por PIN corto asociada a dispositivo de confianza, pensada para uso en cocina. Control de acceso por rol y establecimiento aplicado en la capa de servicio, no solo en la interfaz.

**E. Frontend**

- Autenticación y selector de establecimiento
- Listado y ficha de ítems del catálogo, con gestión de unidades y conversiones
- Editor de escandallo con cálculo de coste en vivo mientras se edita
- Ficha técnica en modo lectura, optimizada para tableta
- Cuadro de mando mínimo: número de platos, food cost medio, platos por encima del objetivo

### Diseño de interfaz

Tres contextos de uso reales, no un único diseño reducido de anchura:

- **Escritorio**: oficina. Tablas densas, edición eficiente, atajos de teclado.
- **Tableta**: partida de cocina. Tipografía y áreas táctiles grandes, legible a un metro, usable con guantes, resistente a toques accidentales.
- **Móvil**: muelle y cámara. Flujos de una sola mano.

Sobre la dirección visual: es una herramienta profesional de uso intensivo y diario, no una web de marketing. Prioriza densidad de información legible, jerarquía tipográfica clara y estados de carga y error explícitos. Define un sistema de tokens propio —paleta, escala tipográfica, espaciado— y respétalo. Evita el aspecto de plantilla genérica de panel de administración; que se note que está diseñada para una cocina y no para un SaaS cualquiera. La cocina es un entorno con mala iluminación en unas zonas y reflejos en otras: el contraste importa más que la sutileza.

Nivel mínimo de calidad, sin anunciarlo: responsive real, foco de teclado visible, respeto a `prefers-reduced-motion`, contraste AA.

### Preparación para el modo sin conexión

No lo implementes todavía, pero deja la arquitectura preparada: capa de acceso a datos abstraída de modo que se pueda insertar una cola de operaciones en IndexedDB sin reescribir los componentes. Documenta el punto de extensión previsto.

### Lo que NO debes hacer en esta iteración

- No implementes inventario, compras, producción, mermas, APPCC ni analítica. Solo deja los módulos vacíos con su estructura de carpetas.
- No uses `any` en TypeScript.
- No uses coma flotante para importes monetarios.
- No pongas lógica de negocio en los componentes de React ni en los controladores. Toda regla de cálculo vive en `packages/domain`.
- No generes datos de ejemplo inventados en el frontend: consume siempre la API.
- No añadas librerías de gráficas, editores enriquecidos ni animaciones que no se usen.

### Cómo quiero que trabajes

1. Primero presenta un plan: estructura de ficheros, modelo de datos y firma de las funciones del motor de costes. Espera mi confirmación antes de escribir código.
2. Empieza por `packages/domain` con sus pruebas. Ese paquete debe estar verde antes de tocar la base de datos.
3. Después esquema y API. Luego frontend.
4. Commits pequeños y con mensaje descriptivo.
5. Si una decisión de dominio te resulta ambigua, pregúntame en lugar de suponer. En cocina las suposiciones sobre mermas y unidades salen caras.
6. Al terminar, deja en el README las instrucciones de arranque y un apartado con las decisiones técnicas que has tomado y por qué.

---
