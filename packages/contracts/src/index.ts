/**
 * @warekai/contracts -- esquemas Zod y tipos compartidos entre API y frontend.
 *
 * Un solo sitio donde se define la forma de los datos que cruzan la red. La
 * API los usa para validar la entrada y documentar OpenAPI; el frontend deriva
 * de ellos sus tipos y la validacion de formularios. Si cambia el contrato,
 * rompe la compilacion en los dos lados a la vez, que es justo lo que se busca.
 */

export * from './common.js';
export * from './catalog.js';
export * from './recipes.js';
export * from './auth.js';
