import type { Unit } from '@warekai/contracts';

/**
 * Elaboraciones y platos de la carta.
 *
 * La cadena mas profunda es deliberada:
 *
 *   Alcachofas confitadas -> Crema de alcachofa -> Fondo oscuro -> Sofrito base
 *
 * Cuatro niveles, con merma de proceso en cada uno. Es el caso que rompe los
 * sistemas que resuelven el escandallo con un `JOIN` de un nivel.
 *
 * `outputQuantity` es siempre la produccion **antes** de la merma de proceso.
 */

export interface SeedRecipeLine {
  item: string;
  quantity: string;
  unit: Unit;
  note?: string;
  cleaningYieldOverride?: string;
}

export interface SeedRecipe {
  code: string;
  name: string;
  family: string;
  /** Unidad en la que se mide la produccion, y en la que se costeara. */
  outputUnit: Unit;
  outputQuantity: string;
  yieldFactor: string;
  portions: number;
  isSale: boolean;
  /** PVP de carta con IVA, en centimos. Solo articulos de venta. */
  listPriceCents?: number;
  vatRate?: string;
  method?: string;
  lines: SeedRecipeLine[];
}

export const SEED_PREPARATIONS: SeedRecipe[] = [
  {
    code: 'PRE-001',
    name: 'Sofrito base',
    family: 'Elaboraciones',
    outputUnit: 'g',
    outputQuantity: '1790',
    // Dos horas a fuego lento: se va casi la mitad en agua.
    yieldFactor: '0.55',
    portions: 1,
    isSale: false,
    method:
      'Pochar la cebolla en el aceite a fuego suave 40 min sin que tome color. ' +
      'Anadir el ajo, el pimiento y por ultimo el tomate. Reducir 60 min mas ' +
      'hasta que suelte el aceite.',
    lines: [
      { item: 'VER-002', quantity: '800', unit: 'g', note: 'en juliana fina' },
      { item: 'VER-005', quantity: '200', unit: 'g' },
      { item: 'VER-004', quantity: '600', unit: 'g', note: 'rallado, sin piel' },
      { item: 'VER-003', quantity: '40', unit: 'g' },
      { item: 'ACE-001', quantity: '150', unit: 'ml' },
    ],
  },
  {
    code: 'PRE-002',
    name: 'Fondo oscuro de ternera',
    family: 'Elaboraciones',
    outputUnit: 'ml',
    outputQuantity: '8000',
    // Reduce al 40 %: de 8 litros salen 3,2.
    yieldFactor: '0.40',
    portions: 1,
    isSale: false,
    method:
      'Tostar huesos y jarrete a 220 C hasta color caoba. Desglasar la bandeja ' +
      'con el vino. Anadir la verdura y el sofrito, cubrir con agua y cocer 8 h ' +
      'a fuego muy suave sin hervir. Colar y reducir a 3,2 l.',
    lines: [
      { item: 'CAR-003', quantity: '3000', unit: 'g' },
      { item: 'CAR-002', quantity: '500', unit: 'g' },
      { item: 'VER-009', quantity: '300', unit: 'g' },
      { item: 'VER-010', quantity: '250', unit: 'g' },
      { item: 'VER-011', quantity: '200', unit: 'g' },
      { item: 'PRE-001', quantity: '300', unit: 'g' },
      { item: 'BEB-002', quantity: '500', unit: 'ml' },
      { item: 'HIE-003', quantity: '3', unit: 'g' },
    ],
  },
  {
    code: 'PRE-003',
    name: 'Fumet de pescado',
    family: 'Elaboraciones',
    outputUnit: 'ml',
    outputQuantity: '5000',
    yieldFactor: '0.75',
    portions: 1,
    isSale: false,
    method:
      'Sudar la verdura, anadir las espinas y el vino. Cubrir con agua fria y ' +
      'cocer 20 min contados desde el hervor. No pasar de ahi o amarga.',
    lines: [
      {
        item: 'PES-001',
        quantity: '1200',
        unit: 'g',
        note: 'espinas y cabezas',
        cleaningYieldOverride: '1',
      },
      { item: 'VER-010', quantity: '200', unit: 'g' },
      { item: 'VER-002', quantity: '200', unit: 'g' },
      { item: 'VER-011', quantity: '100', unit: 'g' },
      { item: 'BEB-001', quantity: '300', unit: 'ml' },
    ],
  },
  {
    code: 'PRE-004',
    name: 'Crema de alcachofa',
    family: 'Elaboraciones',
    outputUnit: 'ml',
    outputQuantity: '2000',
    yieldFactor: '0.80',
    portions: 1,
    isSale: false,
    method:
      'Saltear la alcachofa limpia en la mantequilla. Mojar con el fondo, cocer ' +
      '25 min, anadir la nata y triturar. Colar por estamena.',
    lines: [
      { item: 'VER-001', quantity: '1000', unit: 'g', note: 'corazones limpios' },
      { item: 'PRE-002', quantity: '800', unit: 'ml' },
      { item: 'LAC-001', quantity: '300', unit: 'ml' },
      { item: 'LAC-002', quantity: '60', unit: 'g' },
    ],
  },
  {
    code: 'PRE-005',
    name: 'Salsa espanola',
    family: 'Elaboraciones',
    outputUnit: 'ml',
    outputQuantity: '2200',
    yieldFactor: '0.65',
    portions: 1,
    isSale: false,
    method:
      'Hacer un roux oscuro con la mantequilla y la harina. Mojar poco a poco ' +
      'con el fondo caliente, anadir el vino y reducir a punto de napar.',
    lines: [
      { item: 'PRE-002', quantity: '2000', unit: 'ml' },
      { item: 'LAC-002', quantity: '80', unit: 'g' },
      { item: 'CER-001', quantity: '80', unit: 'g' },
      { item: 'BEB-002', quantity: '200', unit: 'ml' },
    ],
  },
];

export const SEED_DISHES: SeedRecipe[] = [
  {
    code: 'PLA-001',
    name: 'Alcachofas confitadas con crema de su fondo',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '4',
    yieldFactor: '1',
    portions: 4,
    isSale: true,
    listPriceCents: 1650,
    vatRate: '0.10',
    method:
      'Confitar los corazones a 90 C en el aceite 25 min. Escurrir, marcar en ' +
      'plancha muy fuerte y montar sobre la crema caliente.',
    lines: [
      { item: 'VER-001', quantity: '600', unit: 'g' },
      { item: 'ACE-001', quantity: '200', unit: 'ml', note: 'se recupera el 70 %' },
      { item: 'PRE-004', quantity: '400', unit: 'ml' },
      { item: 'ESP-001', quantity: '4', unit: 'g' },
      { item: 'HIE-001', quantity: '10', unit: 'g' },
    ],
  },
  {
    code: 'PLA-002',
    name: 'Carrillera iberica en salsa espanola',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '4',
    yieldFactor: '1',
    portions: 4,
    isSale: true,
    listPriceCents: 2100,
    vatRate: '0.10',
    method:
      'Sellar las carrilleras, cocer 3 h a 140 C cubiertas con la salsa. ' +
      'Acompanar de patata en parmentier.',
    lines: [
      { item: 'CAR-004', quantity: '720', unit: 'g' },
      { item: 'PRE-005', quantity: '500', unit: 'ml' },
      { item: 'VER-012', quantity: '400', unit: 'g' },
      { item: 'LAC-002', quantity: '40', unit: 'g' },
      { item: 'ACE-001', quantity: '60', unit: 'ml' },
      { item: 'ESP-001', quantity: '6', unit: 'g' },
    ],
  },
  {
    code: 'PLA-003',
    name: 'Arroz meloso de pulpo',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '4',
    yieldFactor: '1',
    portions: 4,
    isSale: true,
    listPriceCents: 2400,
    vatRate: '0.10',
    method:
      'Marcar el pulpo, nacarar el arroz con el sofrito y mojar con el fumet ' +
      'caliente en tres veces. 17 min de coccion, 3 de reposo.',
    lines: [
      { item: 'CER-002', quantity: '320', unit: 'g' },
      { item: 'MAR-001', quantity: '400', unit: 'g' },
      { item: 'PRE-003', quantity: '1200', unit: 'ml' },
      { item: 'PRE-001', quantity: '200', unit: 'g' },
      { item: 'ESP-002', quantity: '5', unit: 'g' },
      { item: 'ESP-003', quantity: '0.3', unit: 'g' },
      { item: 'ACE-001', quantity: '50', unit: 'ml' },
    ],
  },
  {
    code: 'PLA-004',
    name: 'Merluza a la bilbaina',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '2',
    yieldFactor: '1',
    portions: 2,
    isSale: true,
    listPriceCents: 2350,
    vatRate: '0.10',
    method:
      'Lomo a la plancha por el lado de la piel. Refreir el ajo laminado en el ' +
      'aceite, retirar del fuego, anadir el vinagre y ligar con los jugos.',
    lines: [
      { item: 'PES-001', quantity: '360', unit: 'g', note: 'lomo limpio' },
      { item: 'VER-003', quantity: '20', unit: 'g' },
      { item: 'ACE-001', quantity: '100', unit: 'ml' },
      { item: 'ACE-003', quantity: '15', unit: 'ml' },
      { item: 'HIE-001', quantity: '5', unit: 'g' },
      { item: 'ESP-001', quantity: '3', unit: 'g' },
    ],
  },
  {
    code: 'PLA-005',
    name: 'Ensalada de tomate, boqueron y almendra',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '2',
    yieldFactor: '1',
    portions: 2,
    isSale: true,
    listPriceCents: 1450,
    vatRate: '0.10',
    method: 'Tomate en rodajas gruesas, boqueron en vinagre, almendra tostada y alino.',
    lines: [
      { item: 'VER-004', quantity: '300', unit: 'g' },
      { item: 'PES-004', quantity: '120', unit: 'g' },
      { item: 'CER-004', quantity: '40', unit: 'g' },
      { item: 'ACE-001', quantity: '40', unit: 'ml' },
      { item: 'ACE-003', quantity: '10', unit: 'ml' },
      { item: 'ESP-001', quantity: '3', unit: 'g' },
    ],
  },
  {
    code: 'PLA-006',
    name: 'Crema de calabaza asada',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '4',
    yieldFactor: '1',
    portions: 4,
    isSale: true,
    listPriceCents: 950,
    vatRate: '0.10',
    method: 'Asar la calabaza a 190 C 40 min. Triturar con el fondo y la nata, colar.',
    lines: [
      { item: 'VER-015', quantity: '800', unit: 'g' },
      { item: 'VER-002', quantity: '150', unit: 'g' },
      { item: 'PRE-002', quantity: '600', unit: 'ml' },
      { item: 'LAC-001', quantity: '200', unit: 'ml' },
      { item: 'ACE-001', quantity: '40', unit: 'ml' },
      { item: 'ESP-001', quantity: '5', unit: 'g' },
    ],
  },
  {
    code: 'PLA-007',
    name: 'Solomillo de ternera con esparragos',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '2',
    yieldFactor: '1',
    portions: 2,
    isSale: true,
    listPriceCents: 2900,
    vatRate: '0.10',
    method: 'Solomillo al punto, esparragos a la brasa, salsa espanola por encima.',
    lines: [
      { item: 'CAR-001', quantity: '360', unit: 'g' },
      { item: 'PRE-005', quantity: '200', unit: 'ml' },
      { item: 'VER-016', quantity: '200', unit: 'g' },
      { item: 'LAC-002', quantity: '30', unit: 'g' },
      { item: 'ESP-004', quantity: '2', unit: 'g' },
      { item: 'ESP-001', quantity: '4', unit: 'g' },
    ],
  },
  {
    code: 'PLA-008',
    name: 'Tarta de queso al horno',
    family: 'Platos de carta',
    outputUnit: 'ud',
    outputQuantity: '8',
    yieldFactor: '1',
    portions: 8,
    isSale: true,
    listPriceCents: 750,
    vatRate: '0.10',
    method: 'Batir sin montar, hornear a 210 C 35 min. Reposar 6 h antes de cortar.',
    lines: [
      { item: 'LAC-004', quantity: '900', unit: 'g' },
      { item: 'LAC-005', quantity: '6', unit: 'ud' },
      { item: 'LAC-001', quantity: '400', unit: 'ml' },
      { item: 'CER-005', quantity: '200', unit: 'g' },
      { item: 'CER-001', quantity: '30', unit: 'g' },
    ],
  },
];
